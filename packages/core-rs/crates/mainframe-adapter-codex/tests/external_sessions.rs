//! Ported from `packages/core/src/plugins/builtin/codex/__tests__/external-sessions.test.ts`.
//!
//! The global meta/prompt caches (module statics) are shared across the whole test
//! binary, so — like vitest's per-file serial run + `beforeEach` cache clear — each
//! test takes a serial lock and clears the cache before running.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use mainframe_adapter_codex::external_sessions::{
    CodexScanDeps, clear_codex_external_session_cache, list_external_sessions,
};
use serde_json::json;
use tempfile::TempDir;
use tokio::sync::{Mutex, MutexGuard};

const PROJECT: &str = "/Users/dev/projects/app";

fn uuid(n: u32) -> String {
    format!("019de09f-93b4-7832-b2aa-c6b3dae2{n:04}")
}

fn serial() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

async fn setup() -> (MutexGuard<'static, ()>, TempDir) {
    let guard = serial().lock().await;
    clear_codex_external_session_cache();
    (guard, tempfile::tempdir().unwrap())
}

#[derive(Default)]
struct RolloutSpec {
    id: String,
    cwd: String,
    branch: Option<String>,
    created_at: Option<String>,
    /// User-message texts, in order (one input_text block each).
    user_messages: Vec<String>,
    /// User messages with multiple input_text blocks each.
    user_block_messages: Vec<Vec<String>>,
    /// Extra malformed/truncated lines appended verbatim.
    raw_trailing: Vec<String>,
    /// mtime as an RFC3339 string; applied via `File::set_modified`.
    mtime: Option<String>,
}

fn deps(root: &TempDir) -> CodexScanDeps {
    CodexScanDeps {
        sessions_root: Some(root.path().to_path_buf()),
    }
}

fn write_rollout(root: &TempDir, spec: &RolloutSpec) -> PathBuf {
    let dir = root.path().join("2026").join("05").join("01");
    fs::create_dir_all(&dir).unwrap();
    let ts = spec
        .created_at
        .clone()
        .unwrap_or_else(|| "2026-05-01T02:00:47.000Z".to_string());

    let mut payload = json!({
        "id": spec.id,
        "timestamp": ts,
        "cwd": spec.cwd,
        "originator": "mainframe",
    });
    if let Some(branch) = &spec.branch {
        payload["git"] = json!({ "branch": branch });
    }
    let meta = json!({ "timestamp": ts, "type": "session_meta", "payload": payload });
    let mut lines = vec![serde_json::to_string(&meta).unwrap()];

    let mut messages: Vec<Vec<String>> = spec.user_block_messages.clone();
    messages.extend(spec.user_messages.iter().map(|t| vec![t.clone()]));
    for blocks in messages {
        let content: Vec<_> = blocks
            .iter()
            .map(|text| json!({ "type": "input_text", "text": text }))
            .collect();
        let line = json!({
            "timestamp": ts,
            "type": "response_item",
            "payload": { "type": "message", "role": "user", "content": content },
        });
        lines.push(serde_json::to_string(&line).unwrap());
    }
    for raw in &spec.raw_trailing {
        lines.push(raw.clone());
    }

    let file_path = dir.join(format!("rollout-2026-05-01T02-00-47-{}.jsonl", spec.id));
    fs::write(&file_path, lines.join("\n") + "\n").unwrap();
    if let Some(mtime) = &spec.mtime {
        let dt = chrono::DateTime::parse_from_rfc3339(mtime).unwrap();
        let st = SystemTime::UNIX_EPOCH + Duration::from_millis(dt.timestamp_millis() as u64);
        let f = OpenOptions::new().write(true).open(&file_path).unwrap();
        f.set_modified(st).unwrap();
    }
    file_path
}

#[tokio::test]
async fn includes_matching_cwd_equal_or_nested_excludes_others() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec!["Fix the login bug".to_string()],
            ..Default::default()
        },
    );
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(2),
            cwd: format!("{PROJECT}/packages/ui"),
            user_messages: vec!["Nested worktree".to_string()],
            ..Default::default()
        },
    );
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(3),
            cwd: "/Users/dev/projects/other".to_string(),
            user_messages: vec!["Different project".to_string()],
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    let mut ids: Vec<String> = page.sessions.iter().map(|s| s.session_id.clone()).collect();
    ids.sort();
    assert_eq!(ids, vec![uuid(1), uuid(2)]);
    assert_eq!(page.total, 2);
    assert!(page.sessions.iter().all(|s| s.adapter_id == "codex"));
}

#[tokio::test]
async fn derives_first_prompt_from_first_non_preamble_message() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec![
                "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>".to_string(),
                "# AGENTS.md instructions for /Users/dev/projects/app\n<INSTRUCTIONS>do things</INSTRUCTIONS>".to_string(),
                "<image name=[Image #1]></image>Add a dark mode toggle to settings".to_string(),
            ],
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    assert_eq!(page.sessions.len(), 1);
    assert_eq!(
        page.sessions[0].first_prompt.as_deref(),
        Some("Add a dark mode toggle to settings")
    );
    assert_eq!(
        page.sessions[0].title.as_deref(),
        Some("Add a dark mode toggle to settings")
    );
}

#[tokio::test]
async fn skips_every_injected_block_then_finds_real_prompt() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_block_messages: vec![vec![
                "<recommended_plugins>\nplugins here\n</recommended_plugins>".to_string(),
                "# AGENTS.md instructions for /app\n<INSTRUCTIONS>x</INSTRUCTIONS>".to_string(),
                "<environment_context>\n<cwd>/app</cwd>\n</environment_context>".to_string(),
            ]],
            user_messages: vec!["Wire up the settings page".to_string()],
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    assert_eq!(
        page.sessions[0].first_prompt.as_deref(),
        Some("Wire up the settings page")
    );
}

#[tokio::test]
async fn falls_back_to_synthetic_title_when_only_preamble() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec![
                "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>".to_string(),
            ],
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    assert_eq!(page.sessions[0].first_prompt, None);
    assert_eq!(page.sessions[0].title.as_deref(), Some("(session)"));
}

#[tokio::test]
async fn excludes_already_imported_session_ids() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec!["one".to_string()],
            ..Default::default()
        },
    );
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(2),
            cwd: PROJECT.to_string(),
            user_messages: vec!["two".to_string()],
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[uuid(1)], None, None, Some(&deps(&root))).await;
    assert_eq!(
        page.sessions
            .iter()
            .map(|s| s.session_id.clone())
            .collect::<Vec<_>>(),
        vec![uuid(2)]
    );
    assert_eq!(page.total, 1);
}

#[tokio::test]
async fn sorts_by_modification_time_descending() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec!["old".to_string()],
            mtime: Some("2026-05-01T00:00:00Z".to_string()),
            ..Default::default()
        },
    );
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(2),
            cwd: PROJECT.to_string(),
            user_messages: vec!["new".to_string()],
            mtime: Some("2026-05-02T00:00:00Z".to_string()),
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    assert_eq!(
        page.sessions
            .iter()
            .map(|s| s.session_id.clone())
            .collect::<Vec<_>>(),
        vec![uuid(2), uuid(1)]
    );
}

#[tokio::test]
async fn paginates_with_total_and_next_offset() {
    let (_g, root) = setup().await;
    for i in 1..=3 {
        write_rollout(
            &root,
            &RolloutSpec {
                id: uuid(i),
                cwd: PROJECT.to_string(),
                user_messages: vec![format!("msg {i}")],
                mtime: Some(format!("2026-05-0{i}T00:00:00Z")),
                ..Default::default()
            },
        );
    }

    let page = list_external_sessions(PROJECT, &[], Some(0), Some(2), Some(&deps(&root))).await;
    assert_eq!(page.total, 3);
    assert_eq!(page.sessions.len(), 2);
    assert_eq!(page.next_offset, Some(2));

    let page2 = list_external_sessions(PROJECT, &[], Some(2), Some(2), Some(&deps(&root))).await;
    assert_eq!(page2.sessions.len(), 1);
    assert_eq!(page2.next_offset, None);
}

#[tokio::test]
async fn count_only_limit_zero_returns_total_without_sessions() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec!["a".to_string()],
            ..Default::default()
        },
    );
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(2),
            cwd: PROJECT.to_string(),
            user_messages: vec!["b".to_string()],
            ..Default::default()
        },
    );

    let page = list_external_sessions(PROJECT, &[], Some(0), Some(0), Some(&deps(&root))).await;
    assert_eq!(page.total, 2);
    assert!(page.sessions.is_empty());
    assert_eq!(page.next_offset, None);
}

#[tokio::test]
async fn captures_the_git_branch_from_meta() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            branch: Some("feat/x".to_string()),
            user_messages: vec!["hi".to_string()],
            ..Default::default()
        },
    );
    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    assert_eq!(page.sessions[0].git_branch.as_deref(), Some("feat/x"));
}

#[tokio::test]
async fn tolerates_malformed_truncated_lines() {
    let (_g, root) = setup().await;
    write_rollout(
        &root,
        &RolloutSpec {
            id: uuid(1),
            cwd: PROJECT.to_string(),
            user_messages: vec!["valid prompt".to_string()],
            raw_trailing: vec![
                "{ this is not json".to_string(),
                "{\"type\":\"response_item\",\"payload\":".to_string(),
            ],
            ..Default::default()
        },
    );
    let page = list_external_sessions(PROJECT, &[], None, None, Some(&deps(&root))).await;
    assert_eq!(page.sessions.len(), 1);
    assert_eq!(
        page.sessions[0].first_prompt.as_deref(),
        Some("valid prompt")
    );
}

#[tokio::test]
async fn returns_empty_page_when_root_does_not_exist() {
    let (_g, root) = setup().await;
    let missing = CodexScanDeps {
        sessions_root: Some(root.path().join("nope")),
    };
    let page = list_external_sessions(PROJECT, &[], None, None, Some(&missing)).await;
    assert!(page.sessions.is_empty());
    assert_eq!(page.total, 0);
    assert_eq!(page.next_offset, None);
}
