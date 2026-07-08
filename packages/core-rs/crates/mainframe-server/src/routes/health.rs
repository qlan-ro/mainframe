//! Ported from `GET /health` in `src/server/http.ts`.
//!
//! Bare-JSON response (not the `{success,data}` envelope) per
//! `docs/rust-port/CONTRACT/routes.json`'s `/health` entry.

use axum::extract::State;
use axum::response::Json;
use serde::Serialize;
use std::sync::Arc;

use crate::http::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: String,
    pub timestamp: String,
    pub tunnel_url: Option<String>,
}

/// `GET /health`. Mirrors `app.get('/health', ...)` in `src/server/http.ts`.
pub async fn get_health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: state.version.clone(),
        timestamp: mainframe_runtime::time::now_iso8601(),
        tunnel_url: state.tunnel_url.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_response_matches_contract_shape() {
        let state = Arc::new(AppState {
            version: "0.0.0-test".to_string(),
            tunnel_url: None,
        });
        let Json(body) = get_health(State(state)).await;
        assert_eq!(body.status, "ok");
        assert_eq!(body.version, "0.0.0-test");
        assert!(body.tunnel_url.is_none());
        // Byte-shape parity with Node's Date.toISOString(): millisecond precision,
        // literal `Z` (e.g. 2026-07-08T10:15:30.000Z), never micros or `+00:00`.
        assert!(
            body.timestamp.ends_with('Z'),
            "timestamp must be Z-suffixed UTC: {}",
            body.timestamp
        );
        assert_eq!(
            body.timestamp.len(),
            24,
            "timestamp must be millis-precision ISO-8601: {}",
            body.timestamp
        );
        assert_eq!(
            &body.timestamp[19..20],
            ".",
            "timestamp must have a fractional-second separator: {}",
            body.timestamp
        );
    }
}

// PORT STATUS: src/server/http.ts (GET /health handler)
// confidence: high
// todos: 0
// notes: field shape verified against docs/rust-port/fixtures/route.health.json;
// `tunnelUrl` serializes as `null` (not omitted) to match the fixture, so no
// `skip_serializing_if` is applied here despite the Option<T> type. `timestamp`
// uses mainframe_runtime::time::now_iso8601() (millis + `Z`, matching Node's
// Date.toISOString() and the fixture's `...000Z`), NOT chrono's to_rfc3339().
