#[tokio::test]
async fn notification_callbacks_need_no_db_actor_call() {
    let deps = Arc::new(test_deps());
    let callback = deps.clone();
    let result = deps.db.call(move |_| {
        let config = mainframe_services::notifications::parse_notification_config(Some(
            r#"{"chat":{"taskComplete":false,"sessionError":false,"attentionRequest":false},"permission":{"toolRequest":false}}"#,
        ));
        callback.set_notification_config(config);
        Ok((callback.notify_task_complete(), callback.notify_session_error(),
            callback.notify_attention_request(), callback.should_notify_permission(Some("Bash"))))
    }).await.unwrap();
    assert_eq!(result, (false, false, false, false));
}
