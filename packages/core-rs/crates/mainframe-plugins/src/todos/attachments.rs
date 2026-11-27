//! Attachment handlers: a thin HTTP layer over the context's attachment
//! store, keyed by todo id.

use std::sync::Arc;

use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::repo;
use super::respond::{bad_request, json_response, not_found, server_error};
use crate::attachment_context::AttachmentUpload;
use crate::context::PluginContext;

pub(super) async fn list_attachments(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
) -> Response {
    let store = match ctx.attachments() {
        Ok(store) => store,
        Err(err) => return server_error(err),
    };
    match store.list(&id).await {
        Ok(metas) => json_response(StatusCode::OK, json!({ "attachments": metas })),
        Err(err) => server_error(err),
    }
}

pub(super) async fn post_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    match repo::exists(&ctx, &id).await {
        Ok(true) => {}
        Ok(false) => return not_found(),
        Err(err) => return server_error(err),
    }
    let Some(upload) = parse_upload(&body) else {
        return bad_request("Invalid input");
    };
    let store = match ctx.attachments() {
        Ok(store) => store,
        Err(err) => return server_error(err),
    };
    match store.save(&id, upload).await {
        Ok(meta) => json_response(StatusCode::CREATED, json!({ "attachment": meta })),
        Err(err) => server_error(err),
    }
}

/// `filename` and `data` are required strings; a missing or non-string
/// `mimeType` is the octet-stream default. A client-sent `sizeBytes` is
/// ignored: the store records the decoded length.
fn parse_upload(body: &Value) -> Option<AttachmentUpload> {
    let filename = body
        .get("filename")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())?;
    let data = body.get("data").and_then(Value::as_str)?;
    let mime_type = body
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream");
    Some(AttachmentUpload {
        filename: filename.to_string(),
        mime_type: mime_type.to_string(),
        data: data.to_string(),
    })
}

pub(super) async fn get_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Response {
    let store = match ctx.attachments() {
        Ok(store) => store,
        Err(err) => return server_error(err),
    };
    match store.get(&id, &attachment_id).await {
        Ok(Some(result)) => (StatusCode::OK, Json(result)).into_response(),
        Ok(None) => not_found(),
        Err(err) => server_error(err),
    }
}

pub(super) async fn delete_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Response {
    let store = match ctx.attachments() {
        Ok(store) => store,
        Err(err) => return server_error(err),
    };
    match store.delete(&id, &attachment_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}
