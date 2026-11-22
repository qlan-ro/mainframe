use std::{net::SocketAddr, sync::Arc};

use axum::{
    Router,
    body::Bytes,
    extract::Request,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{Next, from_fn},
    response::{IntoResponse, Response},
    routing::get,
};
use mainframe_types::external_mcp::{CreateExternalMcpClient, ExternalMcpAccess};
use serde_json::json;

use crate::{
    ctx::AppCtx,
    respond::{ApiError, ok, ok_empty},
};

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/external-mcp/clients", get(list).post(create))
        .route(
            "/api/external-mcp/clients/{id}",
            axum::routing::delete(revoke),
        )
        .route_layer(from_fn(local_only))
}

async fn local_only(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    if !super::auth::local_request(peer, req.headers(), true) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = next.run(req).await;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

async fn list(State(ctx): State<Arc<AppCtx>>) -> Result<Response, ApiError> {
    let clients = ctx.core.db.call(|db| db.external_mcp.list()).await?;
    Ok(ok(
        json!({"clients": clients, "endpoint": format!("http://127.0.0.1:{}/mcp/external", ctx.core.port)}),
    ))
}

async fn create(
    State(ctx): State<Arc<AppCtx>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiError> {
    let json_content = headers
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| {
            h.split(';')
                .next()
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
        });
    if !json_content || body.len() > 16_384 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Expected a JSON client configuration",
        ));
    }
    let input: CreateExternalMcpClient = serde_json::from_slice(&body)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "Invalid client configuration"))?;
    validate(&input)?;
    let token = super::auth::new_token();
    let hash = super::auth::token_hash(&token);
    let client = ctx
        .core
        .db
        .call(move |db| {
            for id in &input.project_ids {
                if db.projects.get(id)?.is_none() {
                    return Err(mainframe_db::DbError::Invalid(
                        "Select existing projects".into(),
                    ));
                }
            }
            db.external_mcp.create(&input, &hash)
        })
        .await?;
    Ok(ok(json!({"client": client, "token": token})))
}

fn validate(input: &CreateExternalMcpClient) -> Result<(), ApiError> {
    let name = input.name.trim();
    let projects: std::collections::HashSet<_> = input.project_ids.iter().collect();
    if name.is_empty()
        || name.chars().count() > 80
        || name.chars().any(char::is_control)
        || input.project_ids.is_empty()
        || input.project_ids.len() > 100
        || projects.len() != input.project_ids.len()
        || input
            .project_ids
            .iter()
            .any(|id| !mainframe_types::ids::is_safe_identifier(id))
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Enter a name and select 1 to 100 distinct projects",
        ));
    }
    if input.answer_prompts && input.access != ExternalMcpAccess::Control {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Answering prompts needs control access",
        ));
    }
    Ok(())
}

async fn revoke(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    ctx.core
        .db
        .call(move |db| db.external_mcp.revoke(&id))
        .await?;
    Ok(ok_empty())
}
