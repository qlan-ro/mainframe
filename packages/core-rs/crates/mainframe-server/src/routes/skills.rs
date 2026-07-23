//! Ported from `src/server/routes/skills.ts` — adapter skill CRUD.
//!
//! Same shape as `agents.rs`: the `Adapter` trait has no skill methods, only the
//! Claude adapter supports them via `mainframe_adapter_claude::skills`, so the
//! `adapter?.listSkills` gate is "registered adapter whose id is claude".

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;

use mainframe_adapter_claude::skills;
use mainframe_types::skill::{AgentScope, CreateSkillInput};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

const NOT_SUPPORTED: &str = "Adapter not found or does not support skills";

fn claude_supported(ctx: &AppCtx, adapter_id: &str) -> bool {
    ctx.adapter_registry
        .get(adapter_id)
        .map(|a| a.id() == "claude")
        .unwrap_or(false)
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

#[derive(Deserialize)]
struct ProjectPathQuery {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
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
        "claude" => ok(skills::list_skills(&project_path).await),
        "mock-cli" => ok(mainframe_adapter_mock::skills::list_skills(&project_path).await),
        _ => fail(StatusCode::NOT_FOUND, NOT_SUPPORTED),
    }
}

#[derive(Deserialize)]
struct CreateSkillBody {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    name: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
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
    let Some(b) = parse_body::<CreateSkillBody>(&body) else {
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
    let input = CreateSkillInput {
        display_name: b.display_name.unwrap_or_else(|| name.clone()),
        name,
        description: b.description.unwrap_or_default(),
        content: b.content.unwrap_or_default(),
        scope: parse_scope(b.scope.as_deref()),
    };
    match skills::create_skill(&project_path, &input).await {
        Ok(skill) => ok(skill),
        Err(err) => {
            tracing::warn!(%adapter_id, name = %input.name, ?err, "Failed to create skill");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

#[derive(Deserialize)]
struct UpdateSkillBody {
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
    let Some(b) = parse_body::<UpdateSkillBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (Some(project_path), Some(content)) = (b.project_path.filter(|p| !p.is_empty()), b.content)
    else {
        return fail(
            StatusCode::BAD_REQUEST,
            "projectPath and content are required",
        );
    };
    match skills::update_skill(&id, &project_path, &content).await {
        Ok(skill) => ok(skill),
        Err(err) => {
            tracing::warn!(skill_id = %id, ?err, "Failed to update skill");
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
    match skills::delete_skill(&id, &project_path).await {
        Ok(()) => crate::respond::ok_empty(),
        Err(err) => {
            tracing::warn!(skill_id = %id, ?err, "Failed to delete skill");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/adapters/{adapterId}/skills", get(list).post(create))
        .route(
            "/api/adapters/{adapterId}/skills/{id}",
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
    async fn list_mock_adapter_scans_project_skills() {
        let temp = tempfile::tempdir().unwrap();
        let skill_dir = temp.path().join(".claude/skills/review");
        tokio::fs::create_dir_all(&skill_dir).await.unwrap();
        tokio::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Review carefully\n---\nBody\n",
        )
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
        assert_eq!(body["data"][0]["id"], "mock-cli:project:review");
    }
}

// PORT STATUS: src/server/routes/skills.ts (4 endpoints, 113 lines)
// confidence: medium
// todos: 0
// notes: Mirror of agents.rs over `mainframe_adapter_claude::skills::{list,create,
// update,delete}_skill`. displayName defaults to name; description/content default
// to "". Zod 400 messages approximated; status codes + hand-written strings match.
