//! Ported from `src/server/routes/attachments.ts` — attachment upload (POST)
//! and serve (GET), backed by the services `AttachmentStore`.
//!
//! Structural note: `AppCtx.services.attachments` is always present (an
//! `Arc<AttachmentStore>`), so the TS "attachment store not configured" 500
//! branch is unreachable in the Rust port — the store cannot be absent. The
//! remaining behavior (count/size/mediaType limits, kind defaulting, the GET
//! 404) is ported 1:1.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::{get, post};
use mainframe_services::attachment::StoredAttachment;
use mainframe_services::attachment::attachment_store::AttachmentKind;
use serde::Deserialize;
use serde_json::json;

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok};

/// 5 MB — `MAX_ATTACHMENT_SIZE_BYTES`.
const MAX_ATTACHMENT_SIZE_BYTES: f64 = 5.0 * 1024.0 * 1024.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadAttachmentsBody {
    attachments: Vec<UploadAttachmentItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadAttachmentItem {
    name: String,
    media_type: String,
    size_bytes: Option<f64>,
    data: String,
    kind: Option<AttachmentKind>,
    original_path: Option<String>,
}

/// `POST /api/chats/:id/attachments`.
async fn upload(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>, body: Bytes) -> Response {
    let parsed: UploadAttachmentsBody = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => return fail(StatusCode::BAD_REQUEST, e.to_string()),
    };
    let attachments = parsed.attachments;
    if attachments.is_empty() || attachments.len() > 10 {
        return fail(
            StatusCode::BAD_REQUEST,
            "Between 1 and 10 attachments required",
        );
    }
    for a in &attachments {
        if a.name.is_empty() || a.media_type.is_empty() || a.data.is_empty() {
            return fail(StatusCode::BAD_REQUEST, "Invalid attachment");
        }
        let computed = (a.data.len() * 3 / 4) as f64;
        let effective = a.size_bytes.unwrap_or(computed);
        if effective > MAX_ATTACHMENT_SIZE_BYTES || computed > MAX_ATTACHMENT_SIZE_BYTES {
            return fail(StatusCode::BAD_REQUEST, "Attachment exceeds 5MB limit");
        }
    }

    let to_save: Vec<StoredAttachment> = attachments
        .into_iter()
        .map(|a| {
            let computed = (a.data.len() * 3 / 4) as f64;
            let kind = a.kind.unwrap_or(if a.media_type.starts_with("image/") {
                AttachmentKind::Image
            } else {
                AttachmentKind::File
            });
            StoredAttachment {
                size_bytes: a.size_bytes.unwrap_or(computed) as i64,
                name: a.name,
                media_type: a.media_type,
                data: a.data,
                kind,
                original_path: a.original_path,
                materialized_path: None,
            }
        })
        .collect();

    match ctx.services.attachments.save(&id, to_save).await {
        Ok(saved) => ok(json!({ "attachments": saved })),
        Err(e) => internal_error("Failed to save attachments", &e),
    }
}

/// `GET /api/chats/:chatId/attachments/:attachmentId`.
async fn serve(
    State(ctx): State<Arc<AppCtx>>,
    Path((chat_id, attachment_id)): Path<(String, String)>,
) -> Response {
    match ctx.services.attachments.get(&chat_id, &attachment_id).await {
        Some(attachment) => ok(attachment),
        None => fail(StatusCode::NOT_FOUND, "Attachment not found"),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/chats/{id}/attachments", post(upload))
        .route("/api/chats/{chatId}/attachments/{attachmentId}", get(serve))
}

// PORT STATUS: src/server/routes/attachments.ts (upload + serve)
// confidence: high
// todos: 0
// notes: The "store not configured" 500 branch is unreachable — AppCtx always
// carries an Arc<AttachmentStore>, so that field cannot be None. Size check is
// byte-identical: computed = floor(len*3/4), rejected when the declared OR
// computed size exceeds 5MB. kind defaults to image/ vs file by mediaType. save
// failure → opaque 500 (Express 5 forwards the async rejection to the global
// handler). GET returns the stored attachment in the success envelope; None →
// 404. No chat-existence check — the TS route performs none either.
