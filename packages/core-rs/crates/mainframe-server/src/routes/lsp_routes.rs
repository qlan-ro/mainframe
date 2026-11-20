use std::sync::Arc;

use axum::Router;
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use mainframe_types::lsp::LspLanguageStatus;
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};

/// `GET /api/lsp/languages`.
async fn get_languages(State(ctx): State<Arc<AppCtx>>, Query(raw): Query<RawQuery>) -> Response {
    // `projectId` is a required non-empty string. Reproduce the Zod-style
    // first-issue message verbatim: a missing param is `expected string,
    // received undefined`; a present-but-empty param gets the "Too small" issue.
    let project_id = match raw.project_id {
        None => {
            return fail(
                axum::http::StatusCode::BAD_REQUEST,
                "Invalid input: expected string, received undefined",
            );
        }
        Some(s) if s.is_empty() => {
            return fail(
                axum::http::StatusCode::BAD_REQUEST,
                "Too small: expected string to have >=1 characters",
            );
        }
        Some(s) => s,
    };

    let manager = &ctx.infra.lsp_manager;
    let active = manager.active_languages(&project_id);
    let mut languages = Vec::new();
    for id in manager.registry().language_ids() {
        languages.push(LspLanguageStatus {
            id: id.to_owned(),
            installed: manager.registry().is_installed(id).await,
            active: active.iter().any(|language| language == id),
        });
    }

    ok(serde_json::json!({ "languages": languages }))
}

/// Raw query wrapper: axum's camelCase `projectId` maps onto `project_id`.
/// `Option` distinguishes a missing param (`None`) from a present-but-empty one
/// (`Some("")`) so each maps to Zod's respective first-issue message.
#[derive(Debug, Deserialize)]
struct RawQuery {
    #[serde(rename = "projectId", default)]
    project_id: Option<String>,
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/lsp/languages", get(get_languages))
}
