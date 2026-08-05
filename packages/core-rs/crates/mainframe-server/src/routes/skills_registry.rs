//! Greenfield (todo #243): `/api/skills-cli/{catalog,search}` — the browsable
//! skills.sh registry. Neither route is project-scoped: the catalog and the
//! search index are the same for every project, and so is the catalog's cache.
//!
//! The daemon proxies both calls rather than letting the renderer make them —
//! the webview's CSP grants no registry origin, and on a remote daemon it is
//! the daemon's host that should reach out. `skills_cli::catalog` does the
//! fetching, caching and parsing; this module only maps outcomes onto the wire
//! contract.

use std::sync::Arc;

use axum::Router;
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;
use serde_json::json;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::skills_cli::CatalogOutcome;
use crate::skills_cli::catalog::{self, HttpFetcher, MIN_QUERY_CHARS};

fn catalog_json(outcome: CatalogOutcome) -> serde_json::Value {
    match outcome {
        CatalogOutcome::Available { entries } => {
            let entries: Vec<serde_json::Value> = entries
                .into_iter()
                .map(|e| {
                    json!({
                        "source": e.source,
                        "skillId": e.skill_id,
                        "name": e.name,
                        "installs": e.installs,
                        "weeklyInstalls": e.weekly_installs,
                        "isOfficial": e.is_official,
                    })
                })
                .collect();
            json!({ "status": "available", "entries": entries })
        }
        CatalogOutcome::Unavailable => json!({ "status": "unavailable" }),
    }
}

// `unavailable` rides the success envelope on purpose: the catalog is a scrape
// of someone else's page, and Browse degrades to search-only rather than
// showing the user an error they can do nothing about.
async fn browse_catalog() -> Response {
    ok(catalog_json(catalog::load(&HttpFetcher).await))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

async fn search(Query(params): Query<SearchQuery>) -> Response {
    let raw = params.q.unwrap_or_default();
    let query = raw.trim();
    if query.chars().count() < MIN_QUERY_CHARS {
        return fail(
            StatusCode::BAD_REQUEST,
            format!("q must be at least {MIN_QUERY_CHARS} characters"),
        );
    }
    match catalog::search(&HttpFetcher, query).await {
        Ok(entries) => ok(json!({ "entries": search_json(entries) })),
        Err(reason) => {
            tracing::warn!(reason, "skills registry search failed");
            fail(StatusCode::BAD_GATEWAY, "Skills registry search failed")
        }
    }
}

fn search_json(entries: Vec<crate::skills_cli::SearchEntry>) -> Vec<serde_json::Value> {
    entries
        .into_iter()
        .map(|e| {
            json!({
                "source": e.source,
                "skillId": e.skill_id,
                "name": e.name,
                "installs": e.installs,
                "isOfficial": e.is_official,
            })
        })
        .collect()
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/skills-cli/catalog", get(browse_catalog))
        .route("/api/skills-cli/search", get(search))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills_cli::{CatalogEntry, SearchEntry};

    #[test]
    fn an_unavailable_catalog_serializes_as_a_status_not_an_empty_list() {
        let json = catalog_json(CatalogOutcome::Unavailable);

        assert_eq!(json["status"], "unavailable");
        assert!(
            json["entries"].is_null(),
            "an empty list would read as 'the registry has no skills'"
        );
    }

    #[test]
    fn a_catalog_entry_carries_its_sparkline_and_official_flag() {
        let outcome = CatalogOutcome::Available {
            entries: vec![CatalogEntry {
                source: "vercel-labs/skills".to_string(),
                skill_id: "find-skills".to_string(),
                name: "find-skills".to_string(),
                installs: 2_787_493,
                weekly_installs: Some(vec![1, 2, 3]),
                is_official: true,
            }],
        };

        let json = catalog_json(outcome);

        let entry = &json["entries"][0];
        assert_eq!(entry["skillId"], "find-skills");
        assert_eq!(entry["installs"], 2_787_493);
        assert_eq!(entry["weeklyInstalls"], json!([1, 2, 3]));
        assert_eq!(entry["isOfficial"], true);
    }

    // Pins what the TS `.nullish()` decodes: search results carry an explicit
    // `null` for the flag the search API doesn't report, so the UI can withhold
    // the official marker instead of asserting a skill isn't official.
    #[test]
    fn a_search_row_serializes_an_unknown_official_flag_as_null() {
        let json = search_json(vec![SearchEntry {
            source: "microsoft/playwright-cli".to_string(),
            skill_id: "playwright-cli".to_string(),
            name: "playwright-cli".to_string(),
            installs: 106_797,
            is_official: None,
        }]);

        assert!(json[0]["isOfficial"].is_null());
        assert_eq!(json[0]["source"], "microsoft/playwright-cli");
    }
}
