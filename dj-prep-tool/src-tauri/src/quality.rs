use std::path::Path;

use rusqlite::params;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityResult {
    pub is_real_flac: Option<bool>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub channels: Option<u32>,
    pub duration_secs: Option<f64>,
    pub spectral_cutoff_hz: Option<u32>,
    pub notes: String,
}

pub async fn check_file(
    app: &AppHandle,
    track_id: i64,
    file_path: &str,
) -> Result<QualityResult, String> {
    let path = file_path.to_string();

    let result = tokio::task::spawn_blocking(move || analyze(&path))
        .await
        .map_err(|e| format!("Analysis task panicked: {e}"))?
        .map_err(|e| e)?;

    let (new_state, quality_str) = match result.is_real_flac {
        Some(false) => ("quality_failed", "fake_flac"),
        _ => ("ready_for_conversion", "ok"),
    };

    let conn = db::open(app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET state = ?1, quality_result = ?2, quality_notes = ?3 WHERE id = ?4",
        params![new_state, quality_str, result.notes, track_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(result)
}

fn analyze(path: &str) -> Result<QualityResult, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "flac" => analyze_flac(path),
        other => Ok(QualityResult {
            is_real_flac: None,
            sample_rate: None,
            bit_depth: None,
            channels: None,
            duration_secs: None,
            spectral_cutoff_hz: None,
            notes: format!(
                "{} file — spectral check not applicable",
                other.to_uppercase()
            ),
        }),
    }
}

fn analyze_flac(path: &str) -> Result<QualityResult, String> {
    let mut reader =
        claxon::FlacReader::open(path).map_err(|e| format!("Cannot open FLAC: {e}"))?;

    let info = reader.streaminfo();
    let sample_rate = info.sample_rate;
    let bit_depth = info.bits_per_sample;
    let channels = info.channels;
    let total_samples = info.samples.unwrap_or(0);
    let duration_secs = if sample_rate > 0 {
        total_samples as f64 / sample_rate as f64
    } else {
        0.0
    };

    // Sample 5s starting at the 45s mark (or 10s before end for short tracks)
    let target_frames = (5 * sample_rate) as u64;
    let start_frame = (45 * sample_rate as u64)
        .min(total_samples.saturating_sub(target_frames));

    let scale = if bit_depth > 0 {
        1.0_f32 / (1_i64 << (bit_depth - 1)) as f32
    } else {
        1.0_f32 / 32_768.0
    };

    let mut mono_buf: Vec<f32> = Vec::with_capacity(target_frames as usize);
    let mut frames_seen: u64 = 0;
    let mut frame_reader = reader.blocks();
    let mut decode_buf = Vec::new();

    'outer: loop {
        let block = match frame_reader
            .read_next_or_eof(decode_buf)
            .map_err(|e| format!("FLAC decode error: {e}"))?
        {
            Some(b) => b,
            None => break,
        };

        let dur = block.duration() as u64;
        let block_start = frames_seen;
        let block_end = frames_seen + dur;
        frames_seen = block_end;

        if block_end > start_frame {
            let local_start = if block_start < start_frame {
                (start_frame - block_start) as u32
            } else {
                0
            };

            for f in local_start..block.duration() {
                let mut sum = 0_i64;
                for ch in 0..channels {
                    sum += block.sample(ch, f) as i64;
                }
                mono_buf.push((sum as f32 / channels as f32) * scale);
                if mono_buf.len() >= target_frames as usize {
                    let _ = block.into_buffer();
                    break 'outer;
                }
            }
        }

        decode_buf = block.into_buffer();
    }

    let (is_real, cutoff_hz) = if mono_buf.len() < 1024 {
        (true, None)
    } else {
        run_fft(&mono_buf, sample_rate)
    };

    let cutoff_label = cutoff_hz
        .map(|hz| format!(" — cutoff ~{}kHz", hz / 1000))
        .unwrap_or_default();

    let notes = if is_real {
        format!(
            "{}Hz / {}-bit / {}ch — {:.0}s{}",
            sample_rate, bit_depth, channels, duration_secs, cutoff_label
        )
    } else {
        format!(
            "{}Hz / {}-bit / {}ch — {:.0}s — HF absent (fake FLAC)",
            sample_rate, bit_depth, channels, duration_secs
        )
    };

    Ok(QualityResult {
        is_real_flac: Some(is_real),
        sample_rate: Some(sample_rate),
        bit_depth: Some(bit_depth),
        channels: Some(channels),
        duration_secs: Some(duration_secs),
        spectral_cutoff_hz: cutoff_hz,
        notes,
    })
}

fn run_fft(samples: &[f32], sample_rate: u32) -> (bool, Option<u32>) {
    let n = samples.len();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);

    let mut buf: Vec<Complex<f32>> = samples
        .iter()
        .map(|&s| Complex { re: s, im: 0.0 })
        .collect();

    fft.process(&mut buf);

    let half = n / 2;
    let freq_res = sample_rate as f32 / n as f32;

    let mut high_energy = 0.0_f32;
    let mut mid_energy = 0.0_f32;
    let mut peak_mag = 0.0_f32;

    for i in 0..half {
        let freq = i as f32 * freq_res;
        let mag = (buf[i].re * buf[i].re + buf[i].im * buf[i].im).sqrt();

        if mag > peak_mag {
            peak_mag = mag;
        }
        if freq > 19_000.0 && freq < 22_050.0 {
            high_energy += mag;
        } else if freq > 5_000.0 && freq < 15_000.0 {
            mid_energy += mag;
        }
    }

    let threshold = peak_mag * 0.01;
    let cutoff_bin = (0..half)
        .rev()
        .find(|&i| (buf[i].re * buf[i].re + buf[i].im * buf[i].im).sqrt() > threshold)
        .unwrap_or(0);

    let cutoff_hz = if cutoff_bin > 0 {
        Some((cutoff_bin as f32 * freq_res) as u32)
    } else {
        None
    };

    let is_real = mid_energy == 0.0 || (high_energy / mid_energy) > 0.001;

    (is_real, cutoff_hz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_result_serializes() {
        let r = QualityResult {
            is_real_flac: Some(true),
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            duration_secs: Some(240.0),
            spectral_cutoff_hz: Some(21000),
            notes: String::new(),
        };
        let j = serde_json::to_string(&r).unwrap();
        assert!(j.contains("isRealFlac"));
        assert!(j.contains("sampleRate"));
        assert!(j.contains("spectralCutoffHz"));
    }

    #[test]
    fn non_flac_returns_null() {
        let r = analyze("/some/file.mp3").unwrap();
        assert!(r.is_real_flac.is_none());
        assert!(r.notes.contains("MP3"));
    }
}
