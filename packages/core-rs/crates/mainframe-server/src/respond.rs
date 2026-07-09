//! Ported from `src/server/routes/respond.ts` — the canonical response envelope.
//!
//! `ok(data)` → `{"success":true,"data":<data>}`, `ok_empty()` →
//! `{"success":true}`, `fail(status, error)` → `{"success":false,"error":"..."}`.
//! Each returns an axum `Response` so route handlers stay `-> Response`.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::json;

/// `ok(res, data)` — wrap `data` in the success envelope with a `200` status.
pub fn ok<T: Serialize>(data: T) -> Response {
    Json(json!({ "success": true, "data": data })).into_response()
}

/// `okEmpty(res)` — success envelope with no payload (state-only mutations).
pub fn ok_empty() -> Response {
    Json(json!({ "success": true })).into_response()
}

/// `fail(res, status, error)` — failure envelope at the given HTTP status.
pub fn fail(status: StatusCode, error: impl Into<String>) -> Response {
    (
        status,
        Json(json!({ "success": false, "error": error.into() })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn body_json(resp: Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn ok_wraps_payload_in_success_true_data() {
        let (status, body) = body_json(ok(json!({ "a": 1 }))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "success": true, "data": { "a": 1 } }));
    }

    #[tokio::test]
    async fn ok_empty_emits_success_true() {
        let (status, body) = body_json(ok_empty()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({ "success": true }));
    }

    #[tokio::test]
    async fn fail_sets_status_and_emits_success_false_error() {
        let (status, body) = body_json(fail(StatusCode::NOT_FOUND, "Not found")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({ "success": false, "error": "Not found" }));
    }
}

// PORT STATUS: src/server/routes/respond.ts (3 helpers)
// confidence: high
// todos: 0
// notes: TS mutates an Express `res`; the Rust port returns an axum `Response`
// so handlers stay `-> Response`. `ok`/`ok_empty` default to 200 (Express
// `res.json` default); `fail` carries the status. Envelope bytes verified
// against respond.test.ts assertions (translated below).
