use super::*;
use crate::jsonrpc::JsonRpcHandlers;

/// A stand-in app-server that answers every request with an empty thread, the
/// way the CLI answers `thread/read` for a child it read from a rollout.
fn empty_thread_server() -> Arc<JsonRpcClient> {
    let child = tokio::process::Command::new("/bin/sh")
        .args([
            "-c",
            r#"while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  printf '{"jsonrpc":"2.0","id":%s,"result":{"thread":{"id":"child","turns":[]}}}\n' "$id"
done"#,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    Arc::new(JsonRpcClient::new(
        child,
        JsonRpcHandlers {
            on_notification: Box::new(|_, _| {}),
            on_request: Box::new(|_, _, _| {}),
            on_error: Box::new(|_| {}),
            on_exit: Box::new(|_| {}),
        },
    ))
}

fn metadata(path: &std::path::Path) -> HashMap<String, AgentMetadata> {
    HashMap::from([(
        "child-1".to_string(),
        AgentMetadata {
            nickname: None,
            role: None,
            rollout_path: Some(path.to_string_lossy().into_owned()),
        },
    )])
}

#[tokio::test]
async fn a_compressed_child_rollout_is_stamped_so_the_history_stays_cacheable() {
    let dir = tempfile::tempdir().unwrap();
    let rollout = dir.path().join("rollout-2026-11-26-child-1.jsonl.zst");
    tokio::fs::write(&rollout, [0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3])
        .await
        .unwrap();
    let server = empty_thread_server();

    let (items, dependencies) = load_children(&server, &["child-1".into()], &metadata(&rollout))
        .await
        .unwrap();
    server.close();

    assert_eq!(items.get("child-1").map(Vec::len), Some(0));
    let dependencies = dependencies.expect("a stamped child keeps the snapshot writable");
    assert_eq!(dependencies.len(), 1);
    assert_eq!(dependencies[0].path, rollout);
    assert_eq!(dependencies[0].len, 7);
    assert!(dependencies[0].is_current().await);
    tokio::fs::write(&rollout, [0x28, 0xb5, 0x2f, 0xfd, 9])
        .await
        .unwrap();
    assert!(
        !dependencies[0].is_current().await,
        "a rewritten compressed rollout must invalidate the stamp"
    );
}

#[tokio::test]
async fn a_child_without_a_rollout_file_still_disables_the_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("rollout-child-1.jsonl.zst");
    let server = empty_thread_server();

    let (_, dependencies) = load_children(&server, &["child-1".into()], &metadata(&missing))
        .await
        .unwrap();
    server.close();

    assert!(dependencies.is_none());
}

#[tokio::test]
async fn a_rollout_path_naming_another_thread_is_not_trusted_as_a_stamp() {
    let dir = tempfile::tempdir().unwrap();
    let other = dir.path().join("rollout-other-thread.jsonl.zst");
    tokio::fs::write(&other, [1, 2, 3]).await.unwrap();
    let server = empty_thread_server();

    let (_, dependencies) = load_children(&server, &["child-1".into()], &metadata(&other))
        .await
        .unwrap();
    server.close();

    assert!(dependencies.is_none());
}
