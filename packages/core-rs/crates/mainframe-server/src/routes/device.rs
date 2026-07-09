//! Ported from `src/server/routes/device.ts` — POST /api/device/activity.
//!
//! Reports desktop foreground/background state to the push service so it can
//! gate mobile notifications. `ActivityBodySchema` (`state: 'active' | 'idle'`)
//! maps to a serde enum; an invalid/absent state yields the exact TS 400 string.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::respond::{fail, ok_empty};
use crate::routes::projects::parse_body;

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum ActivityState {
    Active,
    Idle,
}

#[derive(Deserialize)]
struct ActivityBody {
    state: ActivityState,
}

async fn activity(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(parsed): Option<ActivityBody> = parse_body(&body) else {
        return fail(
            StatusCode::BAD_REQUEST,
            "Invalid body: state must be \"active\" or \"idle\"",
        );
    };
    let active = matches!(parsed.state, ActivityState::Active);
    ctx.services.push.set_desktop_active(active);
    tracing::info!(
        state = if active { "active" } else { "idle" },
        "desktop activity state updated"
    );
    ok_empty()
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route("/api/device/activity", post(activity))
}

// PORT STATUS: src/server/routes/device.ts (1 endpoint, 34 lines)
// confidence: high
// todos: 0
// notes: ActivityBodySchema (z.enum(['active','idle'])) → serde enum
// (rename_all lowercase); parse failure → the verbatim 400 string. pushService?
// .setDesktopActive → ctx.services.push.set_desktop_active. log.info → tracing::info!.
