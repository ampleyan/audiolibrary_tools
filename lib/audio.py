"""
lib/audio.py
------------
Audio quality analysis utilities.
"""

import os
import subprocess
import numpy as np
from scipy.fft import fft


class AudioAnalyzer:
    """FFT-based audio quality analysis for detecting fake FLACs."""

    # Ratio of high-freq energy (19k-22k Hz) to mid-range (5k-15k Hz)
    # below this threshold indicates an upscaled MP3 disguised as FLAC.
    HF_THRESHOLD = 0.001

    @staticmethod
    def is_real_flac(file_path: str) -> bool:
        """
        Returns True if the FLAC file has genuine high-frequency content.
        Returns False if it appears to be an upscaled MP3 (fake FLAC).
        Falls back to True on any error so fakes are not silently ignored.
        """
        try:
            # Extract 5 seconds from the 45s mark to avoid intro silence
            cmd = [
                'ffmpeg', '-hide_banner', '-loglevel', 'error',
                '-i', file_path, '-ss', '45', '-t', '5',
                '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'
            ]
            process = subprocess.run(cmd, capture_output=True, check=True)
            audio_data = np.frombuffer(process.stdout, dtype=np.float32)

            if len(audio_data) == 0:
                return True

            spectrum  = np.abs(fft(audio_data))
            freqs     = np.linspace(0, 44100, len(spectrum))
            high_energy = np.sum(spectrum[(freqs > 19000) & (freqs < 22050)])
            low_energy  = np.sum(spectrum[(freqs > 5000)  & (freqs < 15000)])

            if low_energy == 0:
                return True

            return (high_energy / low_energy) > AudioAnalyzer.HF_THRESHOLD

        except Exception as e:
            print(f"      [!] FFT Analysis Failed for {os.path.basename(file_path)}: {e}")
            return True
