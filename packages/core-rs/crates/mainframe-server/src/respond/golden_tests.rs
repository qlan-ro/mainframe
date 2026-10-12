use super::*;
use axum::body::to_bytes;

#[tokio::test]
async fn baseline_error_envelopes_are_byte_identical() {
    for status in [400, 401, 403, 404, 409, 413, 422, 429, 500, 503] {
        let response = fail(
            StatusCode::from_u16(status).unwrap(),
            "message \"quoted\"\nnext",
        );
        assert_eq!(response.status().as_u16(), status);
        assert_eq!(response.headers()["content-type"], "application/json");
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(
            bytes.as_ref(),
            br#"{"error":"message \"quoted\"\nnext","success":false}"#
        );
    }
}

#[tokio::test]
async fn internal_text_policy_preserves_both_baseline_routes() {
    let error = mainframe_db::DbError::Invariant("private detail".into());
    let cases = [
        (
            fail_with(&error),
            br#"{"error":"private detail","success":false}"#.as_slice(),
        ),
        (
            fail_or_internal("test", &error),
            br#"{"error":"Internal server error","success":false}"#.as_slice(),
        ),
    ];
    for (response, expected) in cases {
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .as_ref(),
            expected
        );
    }
}
