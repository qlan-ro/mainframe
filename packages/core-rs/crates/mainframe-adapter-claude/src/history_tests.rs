use super::*;
use serde_json::json;

#[test]
fn path_resolve_absolute_passthrough() {
    assert_eq!(path_resolve("/proj/dir", "/abs/plan.md"), "/abs/plan.md");
}

#[test]
fn path_resolve_joins_relative() {
    assert_eq!(
        path_resolve("/proj/dir", "plans/x.md"),
        "/proj/dir/plans/x.md"
    );
}

#[test]
fn path_resolve_collapses_dotdot() {
    assert_eq!(path_resolve("/proj/dir", "../plan.md"), "/proj/plan.md");
}

#[tokio::test]
async fn missing_session_returns_empty() {
    assert!(
        load_history("no-such-session-xyz", "/tmp/no-such-project-xyz", None)
            .await
            .is_empty()
    );
    assert!(
        extract_plan_file_paths("no-such-session-xyz", "/tmp/no-such-project-xyz", None)
            .await
            .is_empty()
    );
    assert!(
        extract_skill_file_paths("no-such-session-xyz", "/tmp/no-such-project-xyz", None)
            .await
            .is_empty()
    );
}

fn assistant_line(uuid: &str, text: &str, extra: Value) -> String {
    let mut entry = json!({
        "type": "assistant",
        "uuid": uuid,
        "timestamp": "2026-09-25T00:00:00Z",
        "message": { "content": [{ "type": "text", "text": text }] },
    });
    if let Some(o) = extra.as_object() {
        for (k, v) in o {
            entry[k] = v.clone();
        }
    }
    entry.to_string()
}

fn assistant_text(msg: &ChatMessage) -> &str {
    match &msg.content[0] {
        MessageContent::Leaf(mainframe_types::content::LeafContent::Text { text, .. }) => text,
        other => panic!("expected a text block, got {other:?}"),
    }
}
struct RemoveDirOnDrop(String);
impl Drop for RemoveDirOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn stored_session_file_path_wins_over_the_derived_path_when_both_exist() {
    let dir = tempfile::tempdir().unwrap();
    let stored_path = dir.path().join("relocated.jsonl");
    std::fs::write(
        &stored_path,
        assistant_line("stored-1", "from the stored path", json!({})),
    )
    .unwrap();

    let session_id = format!("mf178-g2-{}-a", std::process::id());
    let project_path = format!("mf178-g2-project-{}-a", std::process::id());
    let derived = get_session_jsonl_path(&session_id, &project_path);
    std::fs::create_dir_all(&derived.project_dir).unwrap();
    std::fs::write(
        &derived.jsonl_path,
        assistant_line("derived-1", "from the derived path", json!({})),
    )
    .unwrap();
    let _cleanup = RemoveDirOnDrop(derived.project_dir.clone());

    let history = load_history(
        &session_id,
        &project_path,
        Some(stored_path.to_str().unwrap()),
    )
    .await;

    assert_eq!(history.len(), 1);
    assert_eq!(assistant_text(&history[0]), "from the stored path");
}

#[tokio::test]
async fn falls_back_to_the_derived_path_when_the_stored_path_is_absent() {
    let dir = tempfile::tempdir().unwrap();
    let gone = dir.path().join("gone.jsonl");

    let session_id = format!("mf178-g2-{}-b", std::process::id());
    let project_path = format!("mf178-g2-project-{}-b", std::process::id());
    let derived = get_session_jsonl_path(&session_id, &project_path);
    std::fs::create_dir_all(&derived.project_dir).unwrap();
    std::fs::write(
        &derived.jsonl_path,
        assistant_line("derived-2", "from the derived path", json!({})),
    )
    .unwrap();
    let _cleanup = RemoveDirOnDrop(derived.project_dir.clone());

    let history = load_history(&session_id, &project_path, Some(gone.to_str().unwrap())).await;

    assert_eq!(history.len(), 1);
    assert_eq!(assistant_text(&history[0]), "from the derived path");
}

#[tokio::test]
async fn discovers_sidechain_files_next_to_the_resolved_stored_path_not_the_derived_directory() {
    let dir = tempfile::tempdir().unwrap();
    let session_id = format!("mf178-g2-{}-c", std::process::id());
    let stored_path = dir.path().join(format!("{session_id}.jsonl"));
    std::fs::write(
        &stored_path,
        assistant_line("primary-1", "primary message", json!({})),
    )
    .unwrap();
    let sidechain_path = dir.path().join("sidechain.jsonl");
    std::fs::write(
        &sidechain_path,
        assistant_line(
            "sidechain-1",
            "sidechain message",
            json!({ "sessionId": session_id }),
        ),
    )
    .unwrap();

    let project_path = format!("mf178-g2-project-{}-c-untouched", std::process::id());
    let discovered = discover_session_jsonl_files(
        &session_id,
        &project_path,
        Some(stored_path.to_str().unwrap()),
    )
    .await;
    assert_eq!(discovered.all_files.len(), 2);

    let history = load_history(
        &session_id,
        &project_path,
        Some(stored_path.to_str().unwrap()),
    )
    .await;
    let texts: HashSet<&str> = history.iter().map(assistant_text).collect();
    assert!(texts.contains("primary message"));
    assert!(texts.contains("sidechain message"));
}
#[tokio::test]
async fn snapshot_dir_loads_the_same_messages_as_the_canonical_path() {
    let line = serde_json::json!({
        "type": "assistant",
        "uuid": "a1",
        "timestamp": "2026-07-04T00:00:01Z",
        "message": { "content": [ { "type": "text", "text": "hi from history" } ] }
    })
    .to_string();
    let project_path = format!("mainframe-test-fork-history-{}", std::process::id());
    let canonical = get_session_jsonl_path("session-fork-1", &project_path);
    tokio::fs::create_dir_all(&canonical.project_dir)
        .await
        .unwrap();
    tokio::fs::write(&canonical.jsonl_path, format!("{line}\n"))
        .await
        .unwrap();
    let _cleanup = RemoveDirOnDrop(canonical.project_dir.clone());
    let snapshot_dir = tempfile::tempdir().unwrap();
    tokio::fs::write(
        snapshot_dir.path().join("session-fork-1.jsonl"),
        format!("{line}\n"),
    )
    .await
    .unwrap();

    let canonical_messages = load_history("session-fork-1", &project_path, None).await;
    let snapshot_messages =
        load_history_in_dir("session-fork-1", &snapshot_dir.path().to_string_lossy()).await;

    assert!(!canonical_messages.is_empty());
    assert_eq!(canonical_messages, snapshot_messages);
}

// ── cold-load profiling (history snapshot cache design, not run in CI) ──────

/// Loads a REAL transcript through the production discover → read → parse →
/// entry → finish pipeline and prints per-phase timings. Opt in with:
/// `MAINFRAME_PROFILE_CLAUDE_TRANSCRIPT=/path/to/session.jsonl cargo test
/// --manifest-path packages/core-rs/Cargo.toml -p mainframe-adapter-claude
/// --release profile_cold_load_from_real_transcript -- --ignored --nocapture`.
/// The session id and project dir are derived from the path (`<dir>/<id>.jsonl`),
/// matching how a real Claude transcript is laid out — so `discover_*` finds
/// the same sibling/subagent files a live cold `get_messages` would.
#[tokio::test]
#[ignore]
async fn profile_cold_load_from_real_transcript() {
    let Ok(path) = std::env::var("MAINFRAME_PROFILE_CLAUDE_TRANSCRIPT") else {
        eprintln!(
            "skipped: set MAINFRAME_PROFILE_CLAUDE_TRANSCRIPT to a real .jsonl path to run this"
        );
        return;
    };
    let file_path = std::path::Path::new(&path);
    let session_id = file_path
        .file_stem()
        .expect("transcript path needs a file stem")
        .to_string_lossy()
        .into_owned();
    let project_dir = file_path
        .parent()
        .expect("transcript path needs a parent dir")
        .to_string_lossy()
        .into_owned();

    let total_start = std::time::Instant::now();
    let discovered = discover_session_jsonl_files_in_dir(&session_id, &project_dir).await;
    let discover_elapsed = total_start.elapsed();

    let (mut read_elapsed, mut parse_elapsed, mut entry_elapsed) = (
        std::time::Duration::ZERO,
        std::time::Duration::ZERO,
        std::time::Duration::ZERO,
    );
    let mut line_count = 0usize;
    let mut load = HistoryLoad::default();
    for file in &discovered.all_files {
        let is_subagent_file = discovered.subagent_files.contains(file);
        let read_start = std::time::Instant::now();
        let Ok(raw) = tokio::fs::read_to_string(file).await else {
            continue;
        };
        read_elapsed += read_start.elapsed();
        for line in raw.lines() {
            if line.trim().is_empty() {
                continue;
            }
            line_count += 1;
            let parse_start = std::time::Instant::now();
            let entry: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            parse_elapsed += parse_start.elapsed();
            let entry_start = std::time::Instant::now();
            load.entry(&entry, &session_id, is_subagent_file);
            entry_elapsed += entry_start.elapsed();
        }
    }
    let finish_start = std::time::Instant::now();
    let messages = load.finish();
    let finish_elapsed = finish_start.elapsed();
    let total_elapsed = total_start.elapsed();

    // What the history snapshot cache (`mainframe-chat::history_cache`) would
    // do instead on the next cold open: decode the already-converted messages
    // from JSON. Same shape as its on-disk `Snapshot` minus a tiny fingerprint.
    let snapshot = serde_json::to_vec(&messages).expect("messages serialize");
    let decode_start = std::time::Instant::now();
    let decoded: Vec<mainframe_types::chat::ChatMessage> =
        serde_json::from_slice(&snapshot).expect("snapshot decodes");
    let decode_elapsed = decode_start.elapsed();
    assert_eq!(decoded.len(), messages.len());

    eprintln!(
        "profile claude session_id={session_id} files={} lines={line_count} messages={} \
         discover={discover_elapsed:?} read={read_elapsed:?} parse={parse_elapsed:?} \
         entry={entry_elapsed:?} finish={finish_elapsed:?} total={total_elapsed:?} \
         snapshot_bytes={} snapshot_decode={decode_elapsed:?}",
        discovered.all_files.len(),
        messages.len(),
        snapshot.len(),
    );
}
