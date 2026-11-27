//! `GET`/`PUT`/`DELETE /link` — the project's single repo link.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Json, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use mainframe_git::is_valid_repo_segment;
use mainframe_types::time::now_iso8601;
use serde_json::{Value, json};

use crate::PluginContext;
use crate::todos_github::{run, store};

use super::{
    as_non_empty_string, bad_request, conflict, json_response, link_json, server_error,
    workflow_labels_json,
};

pub(crate) async fn get_link(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let project_id = match super::require_project_id(&params) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let link = match store::read_link(&ctx, &project_id).await {
        Ok(link) => link,
        Err(err) => return server_error(err),
    };
    let latest_run = match store::latest_run(&ctx, &project_id).await {
        Ok(run) => run,
        Err(err) => return server_error(err),
    };
    json_response(
        StatusCode::OK,
        json!({
            "link": link.as_ref().map(link_json),
            "running": run::is_running(&project_id),
            "latestRunId": latest_run.map(|r| r.id),
            "workflowLabels": workflow_labels_json(),
        }),
    )
}

pub(crate) async fn put_link(
    State(ctx): State<Arc<PluginContext>>,
    Json(body): Json<Value>,
) -> Response {
    let Some(project_id) = as_non_empty_string(&body, "projectId") else {
        return bad_request("projectId required");
    };
    let Some(owner) = as_non_empty_string(&body, "owner") else {
        return bad_request("owner required");
    };
    let Some(repo) = as_non_empty_string(&body, "repo") else {
        return bad_request("repo required");
    };
    if !is_valid_repo_segment(&owner) || !is_valid_repo_segment(&repo) {
        return bad_request("owner and repo must be a valid GitHub owner/repo");
    }
    let Some(remote_name) = as_non_empty_string(&body, "remoteName") else {
        return bad_request("remoteName required");
    };
    let Some(credential_label) = as_non_empty_string(&body, "credentialLabel") else {
        return bad_request("credentialLabel required");
    };

    let link = store::Link {
        project_id,
        owner,
        repo,
        remote_name,
        credential_label,
        last_synced_at: None,
        created_at: now_iso8601(),
    };
    match store::insert_link(&ctx, &link).await {
        Ok(true) => json_response(StatusCode::OK, json!({ "link": link_json(&link) })),
        Ok(false) => conflict("This project is already linked to a GitHub repository."),
        Err(err) => server_error(err),
    }
}

pub(crate) async fn delete_link(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let project_id = match super::require_project_id(&params) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    match store::delete_link(&ctx, &project_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}
