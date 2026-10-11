//! `POST /api/session-transcripts/resolve` — batch @-mention transcript lookup:
//! given a set of chat ids, resolve each one's CLI transcript
//! location without the caller needing to already hold a session id.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use mainframe_types::transcript::{
    ResolveTranscriptsResponse, TranscriptLocation, TranscriptResolution,
    TranscriptUnavailableReason,
};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::body::parse_body;
use mainframe_types::ids::is_safe_identifier;

const MAX_CHAT_IDS: usize = 500;

#[derive(Deserialize)]
struct ResolveBody {
    #[serde(rename = "chatIds")]
    chat_ids: Option<Vec<String>>,
}

fn parse_chat_ids(body: &Bytes) -> Result<Vec<String>, &'static str> {
    let parsed = parse_body::<ResolveBody>(body).ok_or("Invalid request body")?;
    let chat_ids = parsed.chat_ids.ok_or("chatIds is required")?;
    if chat_ids.is_empty() {
        return Err("chatIds must not be empty");
    }
    if chat_ids.len() > MAX_CHAT_IDS {
        return Err("chatIds exceeds the 500-entry limit");
    }
    if !chat_ids.iter().all(|id| is_safe_identifier(id)) {
        return Err("chatIds contains an invalid id");
    }
    Ok(chat_ids)
}

async fn resolve(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let chat_ids = match parse_chat_ids(&body) {
        Ok(ids) => ids,
        Err(msg) => return fail(StatusCode::BAD_REQUEST, msg),
    };
    let mut resolutions = Vec::with_capacity(chat_ids.len());
    for chat_id in chat_ids {
        resolutions.push(resolve_one(&ctx, chat_id).await);
    }
    ok(ResolveTranscriptsResponse { resolutions })
}

/// Per-chat resolution order: missing/unreadable chat or project → `Unknown`;
/// no `vendor_session_id` → `Unavailable(NeverStarted)`; unregistered adapter
/// → `Unknown`; otherwise defer to the adapter's `locate_transcript`.
async fn resolve_one(ctx: &Arc<AppCtx>, chat_id: String) -> TranscriptResolution {
    let chat = {
        let id = chat_id.clone();
        match ctx.core.db.call(move |db| db.chats.get(&id)).await {
            Ok(Some(chat)) => chat,
            Ok(None) | Err(_) => return TranscriptResolution::Unknown { chat_id },
        }
    };

    let Some(session_id) = chat.vendor_session_id.clone() else {
        return TranscriptResolution::Unavailable {
            chat_id,
            reason: TranscriptUnavailableReason::NeverStarted,
        };
    };

    let project_id = chat.project_id.clone();
    let project_path = match ctx
        .core
        .db
        .call(move |db| db.projects.get(&project_id))
        .await
    {
        Ok(Some(project)) => project.path,
        Ok(None) | Err(_) => return TranscriptResolution::Unknown { chat_id },
    };
    let cwd = chat.worktree_path.clone().unwrap_or(project_path);

    let Some(adapter) = ctx.core.adapter_registry.get(&chat.adapter_id) else {
        return TranscriptResolution::Unknown { chat_id };
    };

    match adapter
        .locate_transcript(session_id, cwd, chat.session_file_path.clone())
        .await
    {
        Ok(None) => TranscriptResolution::Unknown { chat_id },
        Ok(Some(TranscriptLocation::Missing)) => TranscriptResolution::Unavailable {
            chat_id,
            reason: TranscriptUnavailableReason::TranscriptMissing,
        },
        Ok(Some(TranscriptLocation::Present(path))) => {
            TranscriptResolution::Resolved { chat_id, path }
        }
        Err(err) => {
            tracing::warn!(chat_id = %chat_id, %err, "locate_transcript failed");
            TranscriptResolution::Unknown { chat_id }
        }
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/session-transcripts/resolve", post(resolve))
}

#[cfg(test)]
#[path = "session_transcripts_tests.rs"]
mod tests;
