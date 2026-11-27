//! `/pairs`, `/pairs/{todoId}`, `/issues`, `/import`, `/publish` — everything
//! about an individual todo↔issue pairing except running a sync.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Json, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::PluginContext;
use crate::todos::repo;
use crate::todos_github::pairing::{self, ImportResult, RemoteIssue};
use crate::todos_github::store;

use super::{
    PairFields, as_non_empty_string, bad_request, json_response, pair_json, pairing_error_response,
    server_error,
};

pub(crate) async fn get_pairs(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let project_id = match super::require_project_id(&params) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let rows = match store::pairs_with_todo_numbers(&ctx, &project_id).await {
        Ok(rows) => rows,
        Err(err) => return server_error(err),
    };
    let pairs: Vec<Value> = rows
        .iter()
        .map(|(pair, todo_number)| stored_pair_json(pair, *todo_number))
        .collect();
    json_response(StatusCode::OK, json!({ "pairs": pairs }))
}

fn stored_pair_json(pair: &store::Pair, todo_number: i64) -> Value {
    pair_json(PairFields {
        todo_id: &pair.todo_id,
        todo_number,
        issue_number: pair.issue_number,
        issue_url: &pair.issue_url,
        pair_state: pair.pair_state,
        state_reason: pair.state_reason.as_deref(),
    })
}

/// Removes only the pairing row (AC26) — no field write, no outbound call.
pub(crate) async fn delete_pair(
    State(ctx): State<Arc<PluginContext>>,
    Path(todo_id): Path<String>,
) -> Response {
    match store::delete_pair(&ctx, &todo_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}

pub(crate) async fn get_issues(
    State(ctx): State<Arc<PluginContext>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let project_id = match super::require_project_id(&params) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    match pairing::list_remote_issues(&ctx, &project_id).await {
        Ok(issues) => {
            let issues: Vec<Value> = issues.iter().map(remote_issue_json).collect();
            json_response(StatusCode::OK, json!({ "issues": issues }))
        }
        Err(err) => pairing_error_response(err),
    }
}

fn remote_issue_json(issue: &RemoteIssue) -> Value {
    json!({
        "number": issue.number,
        "title": issue.title,
        "labels": issue.labels,
        "pairedTodoNumber": issue.paired_todo_number,
    })
}

pub(crate) async fn post_import(
    State(ctx): State<Arc<PluginContext>>,
    Json(body): Json<Value>,
) -> Response {
    let Some(project_id) = as_non_empty_string(&body, "projectId") else {
        return bad_request("projectId required");
    };
    let Some(issue_numbers) = parse_i64_array(&body, "issueNumbers") else {
        return bad_request("issueNumbers must be an array of numbers");
    };
    match pairing::import_issues(&ctx, &project_id, &issue_numbers).await {
        Ok(result) => json_response(StatusCode::OK, import_result_json(&result)),
        Err(err) => pairing_error_response(err),
    }
}

fn parse_i64_array(body: &Value, key: &str) -> Option<Vec<i64>> {
    body.get(key)?
        .as_array()?
        .iter()
        .map(Value::as_i64)
        .collect()
}

fn import_result_json(result: &ImportResult) -> Value {
    let imported: Vec<Value> = result
        .imported
        .iter()
        .map(|i| json!({ "issueNumber": i.issue_number, "todoId": i.todo_id, "todoNumber": i.todo_number }))
        .collect();
    let skipped: Vec<Value> = result
        .skipped
        .iter()
        .map(|s| json!({ "issueNumber": s.issue_number, "reason": s.reason }))
        .collect();
    json!({ "imported": imported, "skipped": skipped })
}

pub(crate) async fn post_publish(
    State(ctx): State<Arc<PluginContext>>,
    Json(body): Json<Value>,
) -> Response {
    let Some(project_id) = as_non_empty_string(&body, "projectId") else {
        return bad_request("projectId required");
    };
    let Some(todo_id) = as_non_empty_string(&body, "todoId") else {
        return bad_request("todoId required");
    };
    let pair = match pairing::publish_task(&ctx, &project_id, &todo_id).await {
        Ok(pair) => pair,
        Err(err) => return pairing_error_response(err),
    };
    let todo_number = match repo::fetch(&ctx, &todo_id).await {
        Ok(todo) => todo.map_or(0, |todo| todo.number),
        Err(err) => return server_error(err),
    };
    json_response(
        StatusCode::OK,
        json!({ "pair": stored_pair_json(&pair, todo_number) }),
    )
}
