//! Cold-load profiling (history snapshot cache design, not run in CI).
//!
//! Codex's main-thread `load_history` goes through a spawned temp app-server
//! plus a `thread/read` JSON-RPC round trip (`session_history.rs`): the CLI
//! binary itself reads and parses the rollout file, so that cost is outside
//! this crate and this harness cannot time it without a real `codex`
//! executable on `PATH`. What this crate *does* own is `rollout_reader`'s
//! direct file parse, used for sub-agent child threads and the PR-scan
//! fallback (`rollout_scan_records`) — this profiles that real path, broken
//! into its two phases (file read, line parse). There is no separate
//! "entry processing"/"finish" stage here: `parse_rollout_lines` folds a line
//! straight into a `ThreadItem`, unlike Claude's multi-stage `HistoryLoad`.
//!
//! Opt in with: `MAINFRAME_PROFILE_CODEX_ROLLOUT=/path/to/rollout.jsonl cargo
//! test --manifest-path packages/core-rs/Cargo.toml -p mainframe-adapter-codex
//! --release profile_cold_load_from_real_rollout -- --ignored --nocapture`.
use crate::rollout_reader::{parse_rollout_lines, read_rollout_items};

#[tokio::test]
#[ignore]
async fn profile_cold_load_from_real_rollout() {
    let Ok(path) = std::env::var("MAINFRAME_PROFILE_CODEX_ROLLOUT") else {
        eprintln!("skipped: set MAINFRAME_PROFILE_CODEX_ROLLOUT to a real rollout .jsonl path");
        return;
    };

    let total_start = std::time::Instant::now();
    let read_start = std::time::Instant::now();
    let raw = tokio::fs::read_to_string(&path)
        .await
        .expect("rollout file should be readable");
    let read_elapsed = read_start.elapsed();

    let parse_start = std::time::Instant::now();
    let items = parse_rollout_lines(&raw);
    let parse_elapsed = parse_start.elapsed();

    // `expected_thread_id: None` skips the filename containment check — this
    // harness doesn't know (or need) the embedded thread id, only that the
    // path resolves inside `~/.codex/sessions`, which the real file does.
    let end_to_end_start = std::time::Instant::now();
    let via_real_entry_point = read_rollout_items(&path, None, None).await;
    let end_to_end_elapsed = end_to_end_start.elapsed();

    assert_eq!(items.len(), via_real_entry_point.len());
    eprintln!(
        "profile codex rollout_path={path} lines={} items={} \
         read={read_elapsed:?} parse={parse_elapsed:?} \
         read_rollout_items_end_to_end={end_to_end_elapsed:?} total={:?}",
        raw.lines().count(),
        items.len(),
        total_start.elapsed(),
    );
}
