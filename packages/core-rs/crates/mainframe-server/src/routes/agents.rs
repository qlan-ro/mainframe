//! Ported from `src/server/routes/agents.ts` — adapter agent CRUD.
//!
//! TS resolves `ctx.adapters.get(adapterId)` and gates on `adapter?.listAgents`.
//! In the Rust port the `Adapter` trait carries no agent methods; only the Claude
//! adapter supports them, exposed as free functions in
//! `mainframe_adapter_claude::skills`. So the capability gate is "adapter is
//! registered AND its id is `claude`", and the CRUD delegates to that module —
//! exactly the TS behaviour (a non-Claude adapter has no `listAgents` → 404).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;

use mainframe_adapter_claude::skills;
use mainframe_types::skill::{AgentScope, CreateAgentInput};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

const NOT_SUPPORTED: &str = "Adapter not found or does not support agents";

/// `ctx.adapters.get(id)?.listAgents`-equivalent: the adapter must be registered
/// and Claude (the only adapter with agent support).
fn claude_supported(ctx: &AppCtx, adapter_id: &str) -> bool {
    ctx.adapter_registry
        .get(adapter_id)
        .map(|a| a.id() == "claude")
        .unwrap_or(false)
}

#[derive(Deserialize)]
struct ProjectPathQuery {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
}

fn parse_scope(scope: Option<&str>) -> AgentScope {
    match scope {
        Some("global") => AgentScope::Global,
        _ => AgentScope::Project,
    }
}

fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

async fn list(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    Query(q): Query<ProjectPathQuery>,
) -> Response {
    let Some(adapter) = ctx.adapter_registry.get(&adapter_id) else {
        return fail(StatusCode::NOT_FOUND, NOT_SUPPORTED);
    };
    let Some(project_path) = q.project_path.filter(|p| !p.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "projectPath is required");
    };
    match adapter.id() {
        "claude" => ok(skills::list_agents(&project_path).await),
        "mock-cli" => ok(mainframe_adapter_mock::skills::list_agents(&project_path).await),
        _ => fail(StatusCode::NOT_FOUND, NOT_SUPPORTED),
    }
}

#[derive(Deserialize)]
struct CreateAgentBody {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    name: Option<String>,
    description: Option<String>,
    content: Option<String>,
    scope: Option<String>,
}

async fn create(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    body: Bytes,
) -> Response {
    if !claude_supported(&ctx, &adapter_id) {
        return fail(StatusCode::NOT_FOUND, NOT_SUPPORTED);
    }
    let Some(b) = parse_body::<CreateAgentBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (Some(project_path), Some(name)) = (
        b.project_path.filter(|p| !p.is_empty()),
        b.name.filter(|n| name_ok(n)),
    ) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "projectPath is required, Name must contain only letters, numbers, hyphens, and underscores",
        );
    };
    let input = CreateAgentInput {
        name,
        description: b.description.unwrap_or_default(),
        content: b.content.unwrap_or_default(),
        scope: parse_scope(b.scope.as_deref()),
    };
    match skills::create_agent(&project_path, &input).await {
        Ok(agent) => ok(agent),
        Err(err) => {
            tracing::warn!(%adapter_id, name = %input.name, ?err, "Failed to create agent");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

#[derive(Deserialize)]
struct UpdateAgentBody {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    content: Option<String>,
}

async fn update(
    State(ctx): State<Arc<AppCtx>>,
    Path((adapter_id, id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    if !claude_supported(&ctx, &adapter_id) {
        return fail(StatusCode::NOT_FOUND, NOT_SUPPORTED);
    }
    let Some(b) = parse_body::<UpdateAgentBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (Some(project_path), Some(content)) = (b.project_path.filter(|p| !p.is_empty()), b.content)
    else {
        return fail(
            StatusCode::BAD_REQUEST,
            "projectPath and content are required",
        );
    };
    match skills::update_agent(&id, &project_path, &content).await {
        Ok(agent) => ok(agent),
        Err(err) => {
            tracing::warn!(agent_id = %id, ?err, "Failed to update agent");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

#[derive(Deserialize)]
struct DeleteBody {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
}

async fn delete(
    State(ctx): State<Arc<AppCtx>>,
    Path((adapter_id, id)): Path<(String, String)>,
    Query(q): Query<ProjectPathQuery>,
    body: Bytes,
) -> Response {
    if !claude_supported(&ctx, &adapter_id) {
        return fail(StatusCode::NOT_FOUND, NOT_SUPPORTED);
    }
    let project_path = q
        .project_path
        .or_else(|| parse_body::<DeleteBody>(&body).and_then(|b| b.project_path))
        .filter(|p| !p.is_empty());
    let Some(project_path) = project_path else {
        return fail(StatusCode::BAD_REQUEST, "projectPath is required");
    };
    match skills::delete_agent(&id, &project_path).await {
        Ok(()) => crate::respond::ok_empty(),
        Err(err) => {
            tracing::warn!(agent_id = %id, ?err, "Failed to delete agent");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/adapters/{adapterId}/agents", get(list).post(create))
        .route(
            "/api/adapters/{adapterId}/agents/{id}",
            axum::routing::put(update).delete(delete),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    #[tokio::test]
    async fn list_unknown_adapter_404() {
        let ctx = AppCtx::test_ctx();
        let resp = list(
            State(ctx.clone()),
            Path("codex".into()),
            Query(ProjectPathQuery {
                project_path: Some("/tmp".into()),
            }),
        )
        .await;
        let (status, body) = read(resp).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], NOT_SUPPORTED);
    }

    #[tokio::test]
    async fn create_unknown_adapter_404() {
        let ctx = AppCtx::test_ctx();
        let resp = create(
            State(ctx.clone()),
            Path("codex".into()),
            axum::body::Bytes::from("{}"),
        )
        .await;
        assert_eq!(read(resp).await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn list_mock_adapter_scans_project_agents() {
        let temp = tempfile::tempdir().unwrap();
        let agent_dir = temp.path().join(".claude/agents");
        tokio::fs::create_dir_all(&agent_dir).await.unwrap();
        tokio::fs::write(agent_dir.join("planner.md"), "# Plans changes\nBody\n")
            .await
            .unwrap();
        let ctx = AppCtx::test_ctx();
        ctx.adapter_registry
            .register(Arc::new(mainframe_adapter_mock::MockCliAdapter::default()));

        let response = list(
            State(ctx),
            Path("mock-cli".into()),
            Query(ProjectPathQuery {
                project_path: Some(temp.path().to_string_lossy().to_string()),
            }),
        )
        .await;
        let (status, body) = read(response).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"][0]["id"], "mock-cli:project:agent:planner");
    }
}

// PORT STATUS: src/server/routes/agents.ts (4 endpoints, 112 lines)
// confidence: medium
// todos: 0
// notes: The Adapter trait has no agent methods; only Claude supports them, so the
// `adapter?.listAgents` capability gate becomes "registered adapter whose id is
// claude", and CRUD delegates to `mainframe_adapter_claude::skills::{list,create,
// update,delete}_agent`. axum percent-decodes `{id}` already, so the TS
// `decodeURIComponent(id)` is implicit. Zod 400 messages are approximated (exact
// per-field issue strings not reproduced); status codes + the hand-written
// "Adapter not found or does not support agents" / "Operation failed" match TS.
