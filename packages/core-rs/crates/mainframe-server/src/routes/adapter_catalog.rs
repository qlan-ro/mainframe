use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;

use mainframe_adapter_claude::skills;
use mainframe_types::skill::{AgentScope, CreateAgentInput, CreateSkillInput};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::body::parse_body;

fn unsupported<const SKILL: bool>() -> &'static str {
    if SKILL {
        "Adapter not found or does not support skills"
    } else {
        "Adapter not found or does not support agents"
    }
}

fn claude_supported(ctx: &AppCtx, adapter_id: &str) -> bool {
    ctx.core
        .adapter_registry
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

#[derive(Deserialize)]
struct ProjectPathQuery {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
}

async fn list<const SKILL: bool>(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    Query(q): Query<ProjectPathQuery>,
) -> Response {
    let Some(adapter) = ctx.core.adapter_registry.get(&adapter_id) else {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    };
    let Some(project_path) = q.project_path.filter(|p| !p.is_empty()) else {
        return fail(StatusCode::BAD_REQUEST, "projectPath is required");
    };
    match adapter.id() {
        "claude" if SKILL => ok(skills::list_skills(&project_path).await),
        "claude" => ok(skills::list_agents(&project_path).await),
        "codex" if SKILL => match mainframe_adapter_codex::skills::list_skills(
            &project_path,
            ctx.core.resolved_path.as_str(),
        )
        .await
        {
            Ok(skills) => ok(skills),
            Err(error) => {
                tracing::warn!(?error, "Failed to list Codex skills");
                fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to list Codex skills",
                )
            }
        },
        "mock-cli" if SKILL => ok(mainframe_adapter_mock::skills::list_skills(&project_path).await),
        "mock-cli" => ok(mainframe_adapter_mock::skills::list_agents(&project_path).await),
        _ => fail(StatusCode::NOT_FOUND, unsupported::<SKILL>()),
    }
}

#[derive(Deserialize)]
struct CreateCatalogBody {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    name: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    description: Option<String>,
    content: Option<String>,
    scope: Option<String>,
}

async fn create<const SKILL: bool>(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    body: Bytes,
) -> Response {
    if !claude_supported(&ctx, &adapter_id) {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    }
    let Some(b) = parse_body::<CreateCatalogBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (Some(project_path), Some(name)) = (
        b.project_path.filter(|p| !p.is_empty()),
        b.name
            .filter(|n| mainframe_types::ids::is_safe_identifier(n)),
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
    let result = if SKILL {
        skills::create_skill(&project_path, &input)
            .await
            .map(|value| serde_json::json!(value))
    } else {
        let input = CreateAgentInput {
            name: input.name.clone(),
            description: input.description.clone(),
            content: input.content.clone(),
            scope: input.scope,
        };
        skills::create_agent(&project_path, &input)
            .await
            .map(|value| serde_json::json!(value))
    };
    match result {
        Ok(skill) => ok(skill),
        Err(err) => {
            tracing::warn!(%adapter_id, name = %input.name, ?err, "Failed to create skill");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

#[derive(Deserialize)]
struct UpdateCatalogBody {
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
    content: Option<String>,
}

async fn update<const SKILL: bool>(
    State(ctx): State<Arc<AppCtx>>,
    Path((adapter_id, id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    if !claude_supported(&ctx, &adapter_id) {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    }
    let Some(b) = parse_body::<UpdateCatalogBody>(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let (Some(project_path), Some(content)) = (b.project_path.filter(|p| !p.is_empty()), b.content)
    else {
        return fail(
            StatusCode::BAD_REQUEST,
            "projectPath and content are required",
        );
    };
    let result = if SKILL {
        skills::update_skill(&id, &project_path, &content)
            .await
            .map(|value| serde_json::json!(value))
    } else {
        skills::update_agent(&id, &project_path, &content)
            .await
            .map(|value| serde_json::json!(value))
    };
    match result {
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

async fn delete<const SKILL: bool>(
    State(ctx): State<Arc<AppCtx>>,
    Path((adapter_id, id)): Path<(String, String)>,
    Query(q): Query<ProjectPathQuery>,
    body: Bytes,
) -> Response {
    if !claude_supported(&ctx, &adapter_id) {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    }
    let project_path = q
        .project_path
        .or_else(|| parse_body::<DeleteBody>(&body).and_then(|b| b.project_path))
        .filter(|p| !p.is_empty());
    let Some(project_path) = project_path else {
        return fail(StatusCode::BAD_REQUEST, "projectPath is required");
    };
    let result = if SKILL {
        skills::delete_skill(&id, &project_path).await
    } else {
        skills::delete_agent(&id, &project_path).await
    };
    match result {
        Ok(()) => crate::respond::ok_empty(),
        Err(err) => {
            tracing::warn!(skill_id = %id, ?err, "Failed to delete skill");
            fail(StatusCode::INTERNAL_SERVER_ERROR, "Operation failed")
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route(
            "/api/adapters/{adapterId}/agents",
            get(list::<false>).post(create::<false>),
        )
        .route(
            "/api/adapters/{adapterId}/agents/{id}",
            axum::routing::put(update::<false>).delete(delete::<false>),
        )
        .route(
            "/api/adapters/{adapterId}/skills",
            get(list::<true>).post(create::<true>),
        )
        .route(
            "/api/adapters/{adapterId}/skills/{id}",
            axum::routing::put(update::<true>).delete(delete::<true>),
        )
}

#[cfg(test)]
#[path = "adapter_catalog/agent_tests.rs"]
mod agent_tests;
#[cfg(test)]
#[path = "adapter_catalog/skill_tests.rs"]
mod skill_tests;
