use super::*;

use crate::test_support::body_json;

#[tokio::test]
async fn list_is_empty_before_any_check() {
    let (status, body) = body_json(list(State(AppCtx::test_ctx())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "success": true, "data": [] }));
}

#[tokio::test]
async fn an_unsafe_provider_id_is_rejected() {
    let ctx = AppCtx::test_ctx();
    let (status, _) = body_json(check(State(ctx.clone()), Path("../codex".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = body_json(update(State(ctx), Path("a b".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_provider_without_a_known_distribution_is_not_found() {
    let (status, body) = body_json(check(State(AppCtx::test_ctx()), Path("mock-cli".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["success"], false);
    assert_eq!(
        body["error"],
        "Mainframe can't check or update this provider's CLI"
    );
}

#[tokio::test]
async fn updating_an_unchecked_cli_is_not_found() {
    let (status, body) = body_json(update(State(AppCtx::test_ctx()), Path("codex".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "The provider CLI was not found");
}
