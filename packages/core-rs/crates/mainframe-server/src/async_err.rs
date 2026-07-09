//! Ported from `src/server/routes/async-handler.ts` + the global error handler
//! in `src/server/http.ts`.
//!
//! Express wraps async handlers so a rejected promise reaches the terminal error
//! middleware, which logs the error and emits `500 {success:false,error:"Internal
//! server error"}` — never leaking the underlying message. Rust handlers return
//! `Result`/`Response` directly (no thrown-exception path), so this module gives
//! route modules the one shared "unexpected error → logged 500 envelope" helper
//! to use in their catch-all arm.

use axum::http::StatusCode;
use axum::response::Response;

use crate::respond::fail;

/// Log `err` under `context` (via `tracing`, mirroring the pino `log.error`) and
/// return the opaque `500` envelope. The caller's error is never sent to the
/// client — only a fixed "Internal server error" string, matching the TS global
/// handler byte-for-byte.
pub fn internal_error(context: &str, err: &dyn std::fmt::Display) -> Response {
    tracing::error!(error = %err, "{context}");
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use mainframe_db::DbError;

    #[tokio::test]
    async fn internal_error_maps_to_opaque_500_envelope() {
        let err = DbError::Message("secret table `devices` is missing".into());
        let resp = internal_error("loading devices", &err);
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body,
            serde_json::json!({ "success": false, "error": "Internal server error" })
        );
        // The underlying message must NOT leak to the wire.
        assert!(!String::from_utf8_lossy(&bytes).contains("devices"));
    }
}

// PORT STATUS: src/server/routes/async-handler.ts + http.ts global error handler
// confidence: high
// todos: 0
// notes: Rust has no thrown-exception path, so `asyncHandler`'s promise-catch is
// not a 1:1 wrapper; its EFFECT (log + opaque 500, no internal leak) is provided
// as `internal_error` for route catch-all arms. Expected 400/404 mappings stay
// route-local (they were explicit `fail(res, 4xx, ...)` calls in the TS too).
