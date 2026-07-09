//! Ported from `src/server/routes/tags.ts` — tag CRUD + per-chat tag assignment.
//!
//! `TagColor` is the shared enum (`z.enum(TAG_PALETTE)` → serde parse; an
//! out-of-palette color fails the body parse → 400). Mutating handlers wrap the
//! repo call and surface any error as a 400 with the verbatim message (the TS
//! `try/catch → String(err.message)`); the read handlers let an error fall
//! through to the opaque 500 (the TS un-wrapped path). DELETE deviates from the
//! rest of the API on purpose: it ends 204 with NO body, not the `{success}`
//! envelope.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use mainframe_types::tags::TagColor;
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::projects::parse_body;

#[derive(Deserialize)]
struct CreateBody {
    name: String,
    color: Option<TagColor>,
}

#[derive(Deserialize)]
struct PatchBody {
    rename: Option<String>,
    color: Option<TagColor>,
}

#[derive(Deserialize)]
struct SetChatTagsBody {
    tags: Vec<String>,
}

fn bad_request(err: &mainframe_db::DbError) -> Response {
    fail(StatusCode::BAD_REQUEST, err.to_string())
}

async fn list(State(ctx): State<Arc<AppCtx>>) -> Response {
    match ctx.db.call(|db| db.tags.list()).await {
        Ok(tags) => ok(tags),
        Err(err) => crate::async_err::internal_error("list tags", &err),
    }
}

async fn create(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(parsed): Option<CreateBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let CreateBody { name, color } = parsed;
    match ctx.db.call(move |db| db.tags.upsert(&name, color)).await {
        Ok(tag) => (StatusCode::CREATED, ok(tag)).into_response(),
        Err(err) => bad_request(&err),
    }
}

async fn update(State(ctx): State<Arc<AppCtx>>, Path(name): Path<String>, body: Bytes) -> Response {
    let Some(parsed): Option<PatchBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if parsed.rename.is_none() && parsed.color.is_none() {
        return fail(StatusCode::BAD_REQUEST, "rename or color required");
    }

    let lookup = name.clone();
    match ctx.db.call(move |db| db.tags.get(&lookup)).await {
        Ok(Some(_)) => {}
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Tag not found"),
        Err(err) => return crate::async_err::internal_error("get tag", &err),
    }

    let PatchBody { rename, color } = parsed;
    let result = ctx
        .db
        .call(move |db| {
            if let Some(ref new_name) = rename {
                db.tags.rename(&name, new_name)?;
            }
            let final_name = rename.as_deref().unwrap_or(&name).to_string();
            if let Some(color) = color {
                db.tags.set_color(&final_name, color)?;
            }
            db.tags.get(&final_name)
        })
        .await;
    match result {
        Ok(tag) => ok(tag),
        Err(err) => bad_request(&err),
    }
}

async fn remove(State(ctx): State<Arc<AppCtx>>, Path(name): Path<String>) -> Response {
    let lookup = name.clone();
    match ctx.db.call(move |db| db.tags.get(&lookup)).await {
        Ok(Some(_)) => {}
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Tag not found"),
        Err(err) => return crate::async_err::internal_error("get tag", &err),
    }
    match ctx.db.call(move |db| db.tags.remove(&name)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(err) => crate::async_err::internal_error("remove tag", &err),
    }
}

async fn list_chat_tags(State(ctx): State<Arc<AppCtx>>, Path(id): Path<String>) -> Response {
    match ctx.db.call(move |db| db.chat_tags.list_for_chat(&id)).await {
        Ok(tags) => ok(tags),
        Err(err) => crate::async_err::internal_error("list chat tags", &err),
    }
}

async fn set_chat_tags(
    State(ctx): State<Arc<AppCtx>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(parsed): Option<SetChatTagsBody> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    let tags = parsed.tags;
    let result = ctx
        .db
        .call(move |db| {
            db.chat_tags.set_for_chat(&id, &tags, &db.tags)?;
            db.chat_tags.list_for_chat(&id)
        })
        .await;
    match result {
        // ctx.chats?.syncChatTags is an optional Phase-4/5 ChatManager hook — a
        // no-op when the manager is absent, so it is intentionally omitted here.
        Ok(persisted) => ok(persisted),
        Err(err) => bad_request(&err),
    }
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/tags", get(list).post(create))
        .route("/api/tags/{name}", patch(update).delete(remove))
        .route(
            "/api/chats/{id}/tags",
            get(list_chat_tags).put(set_chat_tags),
        )
}

// PORT STATUS: src/server/routes/tags.ts (6 endpoints, 98 lines)
// confidence: high
// todos: 0
// notes: z.enum(TAG_PALETTE) → Option<TagColor> serde parse (out-of-palette →
// body-parse fail → 400). PatchBody's `.refine(rename||color)` → explicit
// both-None → 400 "rename or color required". Mutating handlers map DbError →
// 400 with the verbatim message (TS try/catch → String(err.message), which also
// carries the validate-tag-name reserved/short strings); read handlers → opaque
// 500. rename+setColor+get run in ONE db.call so the read-back is atomic on the
// DB thread. DELETE ends 204 with an empty body (the pinned deviation). The
// optional ctx.chats.syncChatTags hook is a Phase-4/5 no-op and is omitted.
