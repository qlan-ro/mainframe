use super::*;

use crate::test_support::read_json as read;

#[tokio::test]
async fn update_config_rejects_a_project_id_field_400() {
    let ctx = AppCtx::test_ctx();
    let resp = update_config(
        State(ctx.clone()),
        Path("nope".into()),
        axum::body::Bytes::from(r#"{"projectId":"other-project"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "projectId cannot be changed");
}

#[tokio::test]
async fn update_config_rejects_a_null_project_id_field_400() {
    // The refusal is keyed on the field's PRESENCE, not its value —
    // an explicit `null` still counts.
    let ctx = AppCtx::test_ctx();
    let resp = update_config(
        State(ctx.clone()),
        Path("nope".into()),
        axum::body::Bytes::from(r#"{"projectId":null}"#),
    )
    .await;
    assert_eq!(read(resp).await.unwrap().0, StatusCode::BAD_REQUEST);
}

#[test]
fn update_chat_config_body_accepts_auto() {
    let body = parse_body::<UpdateChatConfigBody>(&axum::body::Bytes::from(
        r#"{"permissionMode":"auto"}"#,
    ));
    assert!(matches!(
        body.and_then(|b| b.permission_mode),
        Some(ExecutionMode::Auto)
    ));
}

#[test]
fn update_chat_config_body_rejects_unknown_mode() {
    let body = parse_body::<UpdateChatConfigBody>(&axum::body::Bytes::from(
        r#"{"permissionMode":"turbo"}"#,
    ));
    assert!(body.is_none());
}

#[tokio::test]
async fn interrupt_missing_chat_404() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(interrupt(State(ctx.clone()), Path("nope".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat not found");
}

#[tokio::test]
async fn queue_edit_rejects_empty_content_400() {
    let ctx = AppCtx::test_ctx();
    let resp = queue_edit(
        State(ctx.clone()),
        Path(("c".into(), "m".into())),
        axum::body::Bytes::from(r#"{"content":""}"#),
    )
    .await;
    assert_eq!(read(resp).await.unwrap().0, StatusCode::BAD_REQUEST);
}
