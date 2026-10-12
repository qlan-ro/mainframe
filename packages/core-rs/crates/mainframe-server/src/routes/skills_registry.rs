//! `/api/skills-cli/{catalog,search}` — the browsable skills.sh registry.
//! Neither route is project-scoped: the catalog and the search index are the
//! same for every project, and so is the catalog's cache.
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
            tracing::warn!(%reason, "skills registry search failed");
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
#[path = "skills_registry_tests.rs"]
mod tests;
