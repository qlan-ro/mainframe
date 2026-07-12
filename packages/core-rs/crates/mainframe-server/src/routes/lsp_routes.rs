//! Ported from `src/server/routes/lsp-routes.ts` — `GET /api/lsp/languages`.
//!
//! Reports, per registered language, whether its server binary resolves on this
//! machine (`installed`) and whether a live process is running for the project
//! (`active`). The `LspManager` is a Phase-5 handle on `AppCtx`; when it is unwired
//! (route-unit harness) the endpoint reports an empty language list.

use std::sync::Arc;

use axum::Router;
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use mainframe_types::lsp::LspLanguageStatus;
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};

/// `GET /api/lsp/languages`. Mirrors `lspRoutes(manager)`.
async fn get_languages(State(ctx): State<Arc<AppCtx>>, Query(raw): Query<RawQuery>) -> Response {
    // Zod `projectId: z.string().min(1)` — reproduce the first-issue message
    // verbatim: a missing param is `expected string, received undefined`; a
    // present-but-empty param trips the `.min(1)` "Too small" issue.
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

    let Some(manager) = ctx.lsp_manager.as_ref() else {
        // No LSP manager wired — no languages to report (faithful "none active,
        // none installed" for the route-unit harness / a daemon without LSP).
        return ok(serde_json::json!({ "languages": Vec::<LspLanguageStatus>::new() }));
    };

    let active_languages = manager.get_active_languages(&project_id);
    let all_ids = manager.registry().get_all_language_ids();

    let mut languages: Vec<LspLanguageStatus> = Vec::with_capacity(all_ids.len());
    for id in all_ids {
        let resolved = manager.registry().resolve_command(&id).await;
        let active = active_languages.contains(&id);
        languages.push(LspLanguageStatus {
            installed: resolved.is_some(),
            active,
            id,
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

// PORT STATUS: src/server/routes/lsp-routes.ts (44 lines)
// confidence: high
// todos: 0
// notes: `LspLanguagesQuerySchema.safeParse` → a required non-empty `projectId`.
// The 400 body reproduces Zod's first-issue message verbatim: missing param →
// "Invalid input: expected string, received undefined"; empty param → the
// `.min(1)` "Too small: expected string to have >=1 characters".
// Reads active languages from the manager + the registry's language ids, resolving
// each server binary (`resolveCommand`) for `installed`. `active` = the project's
// live processes. The `LspManager` is an Option on AppCtx (Some in the daemon boot);
// when None the endpoint returns an empty language list.
