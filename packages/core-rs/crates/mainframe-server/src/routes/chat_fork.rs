//! `POST /api/chats/{id}/fork` (from-message forks per
//! `docs/specs/2026-10-06-fork-from-message.md`).
//!
//! `ChatManager::fork_chat` runs every eligibility check and maps its own
//! failures to the Daemon contract table's statuses; this handler owns request
//! validation (empty chat id, malformed or unexpected body, a bad
//! `fromMessageId`) and the wire message for an unknown chat id, which the
//! spec gives as the generic "Not found".

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use mainframe_chat::chat_manager::{ForkChatError, ForkPoint};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::identifier::is_identifier;
use crate::routes::projects::parse_body;

/// Longest `fromMessageId` accepted. Chat message ids are nanoids or vendor
/// uuids, far below this; the cap only bounds what a client can send.
const MAX_MESSAGE_ID_LEN: usize = 128;

/// No body, `{}`, or `{"fromMessageId": null}` is a whole-chat fork.
/// `deny_unknown_fields` 400s any other key instead of silently ignoring it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ForkChatBody {
    #[serde(default)]
    from_message_id: Option<String>,
}

/// The fork point a request names, or `None` when its body is invalid.
fn fork_point(body: &Bytes) -> Option<ForkPoint> {
    let parsed = parse_body::<ForkChatBody>(body)?;
    match parsed.from_message_id {
        None => Some(ForkPoint::Current),
        Some(id) if is_identifier(&id) && id.len() <= MAX_MESSAGE_ID_LEN => {
            Some(ForkPoint::BeforeMessage(id))
        }
        Some(_) => None,
    }
}

async fn fork(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>, body: Bytes) -> Response {
    if id.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "id is required");
    }
    let Some(point) = fork_point(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let Some(cm) = ctx.chat_manager.as_ref() else {
        tracing::warn!(chat_id = %id, "fork is a Phase-4 seam (ChatManager unavailable)");
        return fail(StatusCode::INTERNAL_SERVER_ERROR, "fork unavailable");
    };
    match cm.fork_chat(&id, point).await {
        Ok(chat) => ok(chat),
        Err(ForkChatError::NotFound(_)) => fail(StatusCode::NOT_FOUND, "Not found"),
        Err(err) => {
            let status = StatusCode::from_u16(err.status_code())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            if status == StatusCode::INTERNAL_SERVER_ERROR {
                tracing::error!(chat_id = %id, %err, "fork failed");
            }
            fail(status, err.to_string())
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/chats/{id}/fork", post(fork))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(body: &str) -> Option<ForkPoint> {
        fork_point(&Bytes::from(body.to_string()))
    }

    #[test]
    fn no_body_and_an_empty_object_fork_the_whole_chat() {
        assert_eq!(point(""), Some(ForkPoint::Current));
        assert_eq!(point("{}"), Some(ForkPoint::Current));
    }

    #[test]
    fn a_null_from_message_id_forks_the_whole_chat() {
        assert_eq!(point(r#"{"fromMessageId":null}"#), Some(ForkPoint::Current));
    }

    #[test]
    fn a_valid_from_message_id_forks_before_that_message() {
        assert_eq!(
            point(r#"{"fromMessageId":"V1StGXR8_Z5jdHi6B-myT"}"#),
            Some(ForkPoint::BeforeMessage(
                "V1StGXR8_Z5jdHi6B-myT".to_string()
            ))
        );
    }

    #[test]
    fn an_empty_id_is_rejected() {
        assert_eq!(point(r#"{"fromMessageId":""}"#), None);
    }

    #[test]
    fn an_id_outside_the_pattern_is_rejected() {
        assert_eq!(point(r#"{"fromMessageId":"../etc"}"#), None);
        assert_eq!(point(r#"{"fromMessageId":"a b"}"#), None);
        let long = "a".repeat(MAX_MESSAGE_ID_LEN + 1);
        assert_eq!(point(&format!(r#"{{"fromMessageId":"{long}"}}"#)), None);
    }

    #[test]
    fn an_unknown_field_or_malformed_body_is_rejected() {
        assert_eq!(point(r#"{"from_message_id":"m1"}"#), None);
        assert_eq!(point(r#"{"other":1}"#), None);
        assert_eq!(point("not json"), None);
        assert_eq!(point(r#"{"fromMessageId":42}"#), None);
    }
}
