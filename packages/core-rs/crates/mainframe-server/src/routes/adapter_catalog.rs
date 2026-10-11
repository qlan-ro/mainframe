use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;

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

fn writable_provider(
    ctx: &AppCtx,
    adapter_id: &str,
) -> Option<Arc<dyn mainframe_adapter_api::SkillsProvider>> {
    ctx.core
        .adapter_registry
        .get(adapter_id)?
        .skills()
        .filter(|provider| provider.writable())
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
    let Some(provider) = adapter
        .skills()
        .filter(|provider| SKILL || provider.supports_agents())
    else {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    };
    let result = if SKILL {
        provider
            .list_skills(project_path)
            .await
            .map(|value| serde_json::json!(value))
    } else {
        provider
            .list_agents(project_path)
            .await
            .map(|value| serde_json::json!(value))
    };
    match result {
        Ok(value) => ok(value),
        Err(error) => {
            crate::respond::fail_internal(provider.list_error(), &error, provider.list_error())
        }
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
    let Some(provider) = writable_provider(&ctx, &adapter_id) else {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    };
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
        provider
            .create_skill(project_path, input.clone())
            .await
            .map(|value| serde_json::json!(value))
    } else {
        let input = CreateAgentInput {
            name: input.name.clone(),
            description: input.description.clone(),
            content: input.content.clone(),
            scope: input.scope,
        };
        provider
            .create_agent(project_path, input)
            .await
            .map(|value| serde_json::json!(value))
    };
    match result {
        Ok(skill) => ok(skill),
        Err(err) => crate::respond::fail_internal(
            format!(
                "Failed to create skill name={} adapter_id={}",
                input.name, adapter_id
            ),
            &err,
            "Operation failed",
        ),
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
    let Some(provider) = writable_provider(&ctx, &adapter_id) else {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    };
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
        provider
            .update_skill(id.clone(), project_path, content)
            .await
            .map(|value| serde_json::json!(value))
    } else {
        provider
            .update_agent(id.clone(), project_path, content)
            .await
            .map(|value| serde_json::json!(value))
    };
    match result {
        Ok(skill) => ok(skill),
        Err(err) => crate::respond::fail_internal(
            format!("Failed to update skill skill_id={}", id),
            &err,
            "Operation failed",
        ),
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
    let Some(provider) = writable_provider(&ctx, &adapter_id) else {
        return fail(StatusCode::NOT_FOUND, unsupported::<SKILL>());
    };
    let project_path = q
        .project_path
        .or_else(|| parse_body::<DeleteBody>(&body).and_then(|b| b.project_path))
        .filter(|p| !p.is_empty());
    let Some(project_path) = project_path else {
        return fail(StatusCode::BAD_REQUEST, "projectPath is required");
    };
    let result = if SKILL {
        provider.delete_skill(id.clone(), project_path).await
    } else {
        provider.delete_agent(id.clone(), project_path).await
    };
    match result {
        Ok(()) => crate::respond::ok_empty(),
        Err(err) => crate::respond::fail_internal(
            format!("Failed to delete skill skill_id={}", id),
            &err,
            "Operation failed",
        ),
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

#[cfg(test)]
#[path = "adapter_catalog/parity_tests.rs"]
mod parity_tests;
