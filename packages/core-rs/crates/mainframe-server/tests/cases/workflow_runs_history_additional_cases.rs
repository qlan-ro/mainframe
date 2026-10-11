#[tokio::test]
async fn deleted_worktree_keeps_disk_workflow_runs_in_messages() {
    let h = harness("sess-deleted-worktree").await;
    let worktree = tempfile::tempdir().unwrap();
    let path = worktree.path().to_string_lossy().into_owned();
    let _cleanup = write_record(
        &path,
        "sess-deleted-worktree",
        "run-deleted",
        "task-deleted",
    );
    h.ctx
        .core
        .db
        .call({
            let id = h.chat_id.clone();
            move |db| {
                db.chats.update(
                    &id,
                    &ChatPatch {
                        worktree_path: Some(Some(path)),
                        ..Default::default()
                    },
                )
            }
        })
        .await
        .unwrap();
    worktree.close().unwrap();
    let body = h.messages().await;
    assert_eq!(body["success"], true);
    let runs = body["data"]["workflowRuns"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["runId"], "run-deleted");
    assert_eq!(runs[0]["source"], "record");
}
