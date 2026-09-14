use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::scoring::Candidate;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub filename: String,
    pub size: Option<u64>,
    pub state: Option<String>,
}

impl DownloadedFile {
    pub fn is_failed(&self) -> bool {
        matches!(
            self.state.as_deref().map(str::to_lowercase).as_deref(),
            Some("failed") | Some("stalled") | Some("errored")
        )
    }
    pub fn is_complete(&self) -> bool {
        matches!(
            self.state.as_deref().map(str::to_lowercase).as_deref(),
            Some("completed") | Some("succeeded")
        )
    }
}

pub struct SockseekClient {
    client: Client,
    base_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchBody {
    song_query: SongQuery,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SongQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    length: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobSummary {
    job_id: String,
}

#[derive(Deserialize)]
struct ResultsResponse {
    items: Vec<Candidate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDownloadFile {
    filename: String,
    size: Option<u64>,
    state: Option<String>,
}

#[derive(Deserialize)]
struct DownloadResultsResponse {
    items: Vec<RawDownloadFile>,
}

#[derive(Serialize)]
struct FileRef {
    username: String,
    filename: String,
}

#[derive(Serialize)]
struct DownloadBody {
    files: Vec<FileRef>,
}

impl SockseekClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    pub async fn search(
        &self,
        artist: &str,
        title: &str,
        length: Option<i32>,
    ) -> Result<String, reqwest::Error> {
        let body = SearchBody {
            song_query: SongQuery {
                artist: if artist.is_empty() { None } else { Some(artist.to_string()) },
                title: if title.is_empty() { None } else { Some(title.to_string()) },
                length,
            },
        };
        let resp: JobSummary = self
            .client
            .post(format!("{}/api/jobs/search/tracks", self.base_url))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.job_id)
    }

    pub async fn results(&self, job_id: &str) -> Result<Vec<Candidate>, reqwest::Error> {
        let resp: ResultsResponse = self
            .client
            .get(format!("{}/api/jobs/{}/results/files", self.base_url, job_id))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let mut items = resp.items;
        for item in &mut items {
            if item.extension.is_empty() {
                item.extension = std::path::Path::new(&item.filename)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
            }
        }
        Ok(items)
    }

    pub async fn download_results(
        &self,
        dl_job_id: &str,
    ) -> Result<Vec<DownloadedFile>, reqwest::Error> {
        let resp: DownloadResultsResponse = self
            .client
            .get(format!(
                "{}/api/jobs/{}/results/files",
                self.base_url, dl_job_id
            ))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.items.into_iter().map(|f| DownloadedFile {
            filename: f.filename,
            size: f.size,
            state: f.state,
        }).collect())
    }

    pub async fn download(
        &self,
        job_id: &str,
        username: &str,
        filename: &str,
    ) -> Result<String, reqwest::Error> {
        let body = DownloadBody {
            files: vec![FileRef {
                username: username.to_string(),
                filename: filename.to_string(),
            }],
        };
        let resp: Vec<JobSummary> = self
            .client
            .post(format!(
                "{}/api/jobs/{}/downloads/files",
                self.base_url, job_id
            ))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.into_iter().next().map(|j| j.job_id).unwrap_or_default())
    }

    pub async fn cancel(&self, job_id: &str) -> Result<(), reqwest::Error> {
        self.client
            .post(format!("{}/api/jobs/{}/cancel", self.base_url, job_id))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}
