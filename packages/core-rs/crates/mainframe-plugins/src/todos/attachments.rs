//! Attachment handlers: a thin HTTP layer over the context's
//! `PluginAttachments` capability, keyed by todo id.

use std::sync::Arc;

use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::repo;
use super::respond::{bad_request, json_response, not_found, server_error};
use crate::context::{AttachmentUpload, PluginContext};

pub(super) async fn list_attachments(
    State(ctx): State<Arc<PluginContext>>,
    Path(id): Path<String>,
) -> Response {
    match ctx.attachments.list(&id).await {
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
    match ctx.attachments.save(&id, upload).await {
        Ok(meta) => json_response(StatusCode::CREATED, json!({ "attachment": meta })),
        Err(err) => server_error(err),
    }
}

/// `filename` and `data` are required strings; `sizeBytes` defaults to 0 and
/// rejects negatives; a missing or non-string `mimeType` is the octet-stream
/// default.
fn parse_upload(body: &Value) -> Option<AttachmentUpload> {
    let filename = body
        .get("filename")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())?;
    let data = body.get("data").and_then(Value::as_str)?;
    let size_bytes = match body.get("sizeBytes") {
        None | Some(Value::Null) => 0,
        Some(value) => value.as_i64().filter(|size| *size >= 0)?,
    };
    let mime_type = body
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream");
    Some(AttachmentUpload {
        filename: filename.to_string(),
        mime_type: mime_type.to_string(),
        data: data.to_string(),
        size_bytes,
    })
}

pub(super) async fn get_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Response {
    match ctx.attachments.get(&id, &attachment_id).await {
        Ok(Some(result)) => json_response(
            StatusCode::OK,
            serde_json::to_value(result).unwrap_or(Value::Null),
        ),
        Ok(None) => not_found(),
        Err(err) => server_error(err),
    }
}

pub(super) async fn delete_attachment(
    State(ctx): State<Arc<PluginContext>>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Response {
    match ctx.attachments.delete(&id, &attachment_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => server_error(err),
    }
}
