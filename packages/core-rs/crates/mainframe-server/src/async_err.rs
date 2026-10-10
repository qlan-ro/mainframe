//! The shared "unexpected error → logged 500 envelope" helper route modules use
//! in their catch-all arm. It logs the error and emits
//! `500 {success:false,error:"Internal server error"}` — never leaking the
//! underlying message to the client.

use axum::http::StatusCode;
use axum::response::Response;

use crate::respond::fail;

/// Log `err` under `context` (via `tracing`) and return the opaque `500`
/// envelope. The caller's error is never sent to the client — only a fixed
/// "Internal server error" string.
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
