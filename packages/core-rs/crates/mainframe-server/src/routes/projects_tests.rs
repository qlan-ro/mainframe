use mainframe_types::seam_error::SeamError;

use super::*;

use crate::test_support::body_json;

#[tokio::test]
async fn removal_response_ok_emits_the_empty_success_envelope() {
    let (status, body) = body_json(removal_response(Ok(()))).await.unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));
}

#[tokio::test]
async fn removal_response_err_emits_the_failure_envelope_with_the_message() {
    let store = RemoveProjectError::Store(SeamError::msg("database is locked"));
    let (status, body) = body_json(removal_response(Err(store))).await.unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body,
        json!({ "success": false, "error": "database is locked" })
    );
}

#[tokio::test]
async fn get_one_404s_for_the_hidden_scratch_project_row() {
    let ctx = AppCtx::test_ctx();
    let (status, body) =
        body_json(get_one(State(ctx.clone()), Path("mainframe-no-project".to_string())).await)
            .await
            .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Project not found");
}

#[tokio::test]
async fn list_never_returns_the_hidden_scratch_project_row() {
    let ctx = AppCtx::test_ctx();
    let (_, body) = body_json(list(State(ctx.clone())).await).await.unwrap();
    let ids: Vec<String> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    assert!(!ids.contains(&"mainframe-no-project".to_string()));
}

// ── DELETE via a real ChatManager ────────────────────────────────────────

#[tokio::test]
async fn removing_a_project_deletes_its_temporary_chat_and_stops_the_process() {
    let ctx = AppCtx::test_ctx();
    let adapter = crate::chat_test_support::StubAdapter::new("claude", false);
    ctx.core.adapter_registry.register(adapter.clone());
    let project_dir = std::env::temp_dir().join(format!("mf-remove-temp-{}", nanoid::nanoid!()));
    std::fs::create_dir_all(&project_dir).unwrap();
    let project_path = project_dir.to_string_lossy().into_owned();
    let project = ctx
        .core
        .db
        .call(move |db| db.projects.create(&project_path, None))
        .await
        .unwrap();
    let chat = ctx
        .chat
        .chat_manager
        .as_ref()
        .create_chat_with_defaults(
            mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                temporary: true,
                ..Default::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
    ctx.chat.chat_manager.as_ref().start_chat(&chat.id).await;

    let (status, _) = body_json(remove(State(ctx.clone()), Path(project.id.clone())).await)
        .await
        .unwrap();
    assert_eq!(
        adapter.kills.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "removing the project must stop the temporary chat's live process"
    );
    assert_eq!(status, StatusCode::OK);

    assert!(
        ctx.core
            .db
            .call(move |db| db.chats.get(&chat.id))
            .await
            .unwrap()
            .is_none(),
        "the temporary chat's row must be deleted along with its project"
    );
    assert!(
        ctx.core
            .db
            .call(move |db| db.projects.get(&project.id))
            .await
            .unwrap()
            .is_none()
    );
}

/// Intentional change: refusing the hidden scratch project answered 500;
/// the request is what is wrong, so it is now a 400 with the same text.
#[tokio::test]
async fn delete_refuses_the_hidden_scratch_project() {
    let ctx = AppCtx::test_ctx();
    let (status, body) =
        body_json(remove(State(ctx.clone()), Path("mainframe-no-project".to_string())).await)
            .await
            .unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "success": false, "error": "cannot remove the hidden scratch project" })
    );
}
