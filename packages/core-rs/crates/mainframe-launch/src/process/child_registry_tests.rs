use super::*;

fn tunnel_entry(pid: i64) -> ManagedChildEntry {
    tunnel_entry_labeled(pid, format!("preview:{pid}"))
}

fn tunnel_entry_labeled(pid: i64, label: String) -> ManagedChildEntry {
    ManagedChildEntry {
        pid,
        kind: ManagedChildKind::Tunnel,
        command: "/home/user/.mainframe/bin/bin/cloudflared".to_string(),
        args: vec![],
        cwd: None,
        group: false,
        label,
        spawned_at: 1_000,
    }
}

fn launch_entry(pid: i64) -> ManagedChildEntry {
    launch_entry_named(pid, format!("dev-{pid}"))
}

fn launch_entry_named(pid: i64, name: String) -> ManagedChildEntry {
    ManagedChildEntry {
        pid,
        kind: ManagedChildKind::Launch,
        command: "/opt/homebrew/bin/pnpm".to_string(),
        args: vec!["run".to_string(), "dev".to_string()],
        cwd: Some("/Users/me/project".to_string()),
        group: true,
        label: format!("proj:{name}"),
        spawned_at: 2_000,
    }
}

fn temp_file() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("managed-children.json");
    (dir, file.to_string_lossy().into_owned())
}

#[tokio::test]
async fn list_returns_empty_when_the_file_does_not_exist() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file);
    assert_eq!(registry.list().await, vec![]);
}

#[tokio::test]
async fn persists_entries_of_both_kinds_across_instances() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file.clone());
    registry.add(tunnel_entry(111)).await;
    registry.add(launch_entry(222)).await;
    let reopened = FileChildRegistry::new(file);
    assert_eq!(
        reopened.list().await,
        vec![tunnel_entry(111), launch_entry(222)]
    );
}

#[tokio::test]
async fn list_by_kind_filters_by_kind() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file);
    registry.add(tunnel_entry(111)).await;
    registry.add(launch_entry(222)).await;
    assert_eq!(
        registry.list_by_kind(ManagedChildKind::Launch).await,
        vec![launch_entry(222)]
    );
    assert_eq!(
        registry.list_by_kind(ManagedChildKind::Tunnel).await,
        vec![tunnel_entry(111)]
    );
}

#[tokio::test]
async fn remove_drops_only_the_matching_pid() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file);
    registry.add(tunnel_entry(111)).await;
    registry.add(launch_entry(222)).await;
    registry.remove(111).await;
    assert_eq!(registry.list().await, vec![launch_entry(222)]);
}

#[tokio::test]
async fn replaces_an_existing_entry_with_the_same_pid_rather_than_duplicating() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file);
    registry
        .add(launch_entry_named(111, "first".to_string()))
        .await;
    registry
        .add(launch_entry_named(111, "second".to_string()))
        .await;
    let list = registry.list().await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].label, "proj:second");
}

#[tokio::test]
async fn clear_empties_the_registry() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file);
    registry.add(tunnel_entry(111)).await;
    registry.clear().await;
    assert_eq!(registry.list().await, vec![]);
}

#[tokio::test]
async fn does_not_lose_entries_under_concurrent_adds() {
    let (_dir, file) = temp_file();
    let registry = std::sync::Arc::new(FileChildRegistry::new(file));
    let mut handles = vec![];
    for pid in 1..=5 {
        let registry = registry.clone();
        handles.push(tokio::spawn(async move {
            registry.add(launch_entry(pid)).await;
        }));
    }
    for handle in handles {
        handle.await.unwrap();
    }
    let mut pids: Vec<i64> = registry.list().await.into_iter().map(|e| e.pid).collect();
    pids.sort_unstable();
    assert_eq!(pids, vec![1, 2, 3, 4, 5]);
}

#[tokio::test]
async fn tolerates_a_corrupt_registry_file_and_treats_it_as_empty() {
    let (_dir, file) = temp_file();
    tokio::fs::write(&file, "not json{{{").await.unwrap();
    let registry = FileChildRegistry::new(file);
    assert_eq!(registry.list().await, vec![]);
    registry.add(tunnel_entry(111)).await;
    assert_eq!(registry.list().await, vec![tunnel_entry(111)]);
}

#[tokio::test]
async fn tolerates_a_stale_old_format_cloudflared_registry_file() {
    // The pre-generalization format was { pid, label, binPath, spawnedAt } —
    // no kind/command/args/cwd/group. Such entries must be dropped, not crash.
    let (_dir, file) = temp_file();
    let stale = serde_json::json!([
        { "pid": 999, "label": "daemon", "binPath": "/x/cloudflared", "spawnedAt": 1 },
        launch_entry(5),
    ]);
    tokio::fs::write(&file, serde_json::to_string(&stale).unwrap())
        .await
        .unwrap();
    let registry = FileChildRegistry::new(file);
    assert_eq!(registry.list().await, vec![launch_entry(5)]);
}

#[tokio::test]
async fn drops_malformed_entries_when_reading() {
    let (_dir, file) = temp_file();
    let mixed = serde_json::json!([
        tunnel_entry(111),
        { "pid": "nope" },
        { "kind": "launch" },
        null,
    ]);
    tokio::fs::write(&file, serde_json::to_string(&mixed).unwrap())
        .await
        .unwrap();
    let registry = FileChildRegistry::new(file);
    assert_eq!(registry.list().await, vec![tunnel_entry(111)]);
}

#[tokio::test]
async fn writes_atomically_without_leaving_a_tmp_file_behind() {
    let (_dir, file) = temp_file();
    let registry = FileChildRegistry::new(file.clone());
    registry.add(tunnel_entry(111)).await;
    let contents = tokio::fs::read_to_string(&file).await.unwrap();
    let parsed: Vec<ManagedChildEntry> = serde_json::from_str(&contents).unwrap();
    assert_eq!(parsed, vec![tunnel_entry(111)]);
}

#[tokio::test]
async fn noop_registry_is_inert() {
    let registry = NoopChildRegistry;
    registry.add(tunnel_entry(1)).await;
    registry.remove(1).await;
    registry.clear().await;
    assert_eq!(registry.list().await, vec![]);
    assert_eq!(
        registry.list_by_kind(ManagedChildKind::Launch).await,
        vec![]
    );
}
