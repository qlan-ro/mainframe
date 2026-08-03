//! The skills.sh registry: the browsable catalog and the search proxy.
//!
//! Both calls are made here rather than in the renderer — the daemon's host is
//! the one that should reach the registry, and the Tauri webview would need a
//! CSP grant it doesn't have. Extraction of the catalog itself lives in
//! [`super::catalog_parse`].

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use super::{BoxFuture, CatalogEntry, CatalogOutcome, SearchEntry};

const HOME_URL: &str = "https://www.skills.sh/";
const SEARCH_URL: &str = "https://skills.sh/api/search";
const SEARCH_LIMIT: usize = 50;
/// Below this the registry rejects the query anyway, so the round trip is
/// spent for nothing.
pub const MIN_QUERY_CHARS: usize = 2;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
/// The real homepage is ~1 MB; the cap keeps a misbehaving upstream from
/// buffering an unbounded body into the daemon.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// The seam the registry calls go through: production wiring passes
/// [`HttpFetcher`], tests pass a double. Mirrors [`super::SkillsCliRunner`].
pub trait RegistryFetcher: Send + Sync {
    fn get(&self, url: String) -> BoxFuture<'_, Result<String, String>>;
}

/// `reqwest` with a bounded timeout, redirect-follow (the apex 308-redirects
/// to `www`) and a capped body.
pub struct HttpFetcher;

impl RegistryFetcher for HttpFetcher {
    fn get(&self, url: String) -> BoxFuture<'_, Result<String, String>> {
        Box::pin(async move {
            let client = reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .map_err(|e| e.to_string())?;
            let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!("registry responded {}", response.status()));
            }
            let body = response.text().await.map_err(|e| e.to_string())?;
            if body.len() > MAX_BODY_BYTES {
                return Err("registry response exceeded the size cap".to_string());
            }
            Ok(body)
        })
    }
}

type Cache = Mutex<Option<(Instant, Vec<CatalogEntry>)>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// The catalog, from the 6h cache when it's warm. The lock is held across the
/// fetch on purpose: concurrent panel opens then wait on one request instead of
/// fanning out duplicates at the registry.
pub async fn load(fetcher: &dyn RegistryFetcher) -> CatalogOutcome {
    let mut guard = cache().lock().await;
    if let Some((fetched_at, entries)) = guard.as_ref()
        && fetched_at.elapsed() < CACHE_TTL
    {
        return CatalogOutcome::Available {
            entries: entries.clone(),
        };
    }
    let html = match fetcher.get(HOME_URL.to_string()).await {
        Ok(html) => html,
        Err(reason) => {
            tracing::warn!(reason, "skills registry homepage fetch failed");
            return CatalogOutcome::Unavailable;
        }
    };
    let Some(entries) = super::catalog_parse::extract_initial_skills(&html) else {
        tracing::warn!("skills registry homepage carried no parsable catalog");
        return CatalogOutcome::Unavailable;
    };
    *guard = Some((Instant::now(), entries.clone()));
    CatalogOutcome::Available { entries }
}

#[derive(serde::Deserialize)]
struct RawSearchResponse {
    skills: Vec<RawSearchEntry>,
}

#[derive(serde::Deserialize)]
struct RawSearchEntry {
    source: String,
    #[serde(rename = "skillId")]
    skill_id: Option<String>,
    name: String,
    #[serde(default)]
    installs: u64,
    // The search API doesn't return this today; `Option` keeps "unknown"
    // distinct from "not official" so the UI can withhold the marker rather
    // than assert its absence.
    #[serde(default, rename = "isOfficial")]
    is_official: Option<bool>,
}

/// Proxies the registry's search API. `Err` carries a reason for the log and
/// the failure body; the caller has already rejected queries that are too
/// short.
pub async fn search(
    fetcher: &dyn RegistryFetcher,
    query: &str,
) -> Result<Vec<SearchEntry>, String> {
    let mut url = reqwest::Url::parse(SEARCH_URL).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("limit", &SEARCH_LIMIT.to_string());
    let body = fetcher.get(url.to_string()).await?;
    let parsed: RawSearchResponse =
        serde_json::from_str(&body).map_err(|e| format!("registry search response: {e}"))?;
    Ok(parsed
        .skills
        .into_iter()
        .map(|raw| SearchEntry {
            source: raw.source,
            skill_id: raw.skill_id.unwrap_or_else(|| raw.name.clone()),
            name: raw.name,
            installs: raw.installs,
            is_official: raw.is_official,
        })
        .collect())
}
