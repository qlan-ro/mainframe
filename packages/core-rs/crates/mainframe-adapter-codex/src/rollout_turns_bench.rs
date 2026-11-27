//! Opt-in large-file timing for the PR scan, split out of the parity tests.
#![allow(clippy::unwrap_used, reason = "Test assertions")]

use super::super::*;
use super::fixtures::{
    assistant, convert_rollout_whole_string, event, exec, exec_output, line, user,
};
use mainframe_adapter_api::pr_detection::scan_history_for_prs;
use serde_json::json;

/// Writes about `target_mb` MB of synthetic rollout: many turns, each with
/// filler tool output (no real content), a PR-create every 500 turns.
fn write_synthetic(path: &std::path::Path, target_mb: usize) -> usize {
    use std::io::Write;
    let mut out = std::io::BufWriter::new(std::fs::File::create(path).unwrap());
    let filler = "lorem ipsum dolor sit amet ".repeat(300);
    let (mut written, mut turn) = (0usize, 0u32);
    while written < target_mb * 1024 * 1024 {
        let mut lines = vec![event("task_started", &format!("t{turn}")), user("go")];
        for k in 0..6 {
            let call = format!("c{turn}-{k}");
            lines.push(exec(&call, "ls"));
            lines.push(exec_output(&call, &filler));
            lines.push(line(
                "event_msg",
                json!({"type": "token_count", "info": {"total": turn}}),
            ));
        }
        if turn % 500 == 0 {
            let call = format!("pr{turn}");
            lines.push(exec(&call, "gh pr create --title x"));
            lines.push(exec_output(
                &call,
                &format!("https://github.com/acme/repo/pull/{}\n", turn / 500 + 1),
            ));
        }
        lines.push(assistant("done"));
        lines.push(event("task_complete", &format!("t{turn}")));
        for l in lines {
            out.write_all(l.as_bytes()).unwrap();
            out.write_all(b"\n").unwrap();
            written += l.len() + 1;
        }
        turn += 1;
    }
    out.flush().unwrap();
    written
}

/// Old vs new on a ~230 MB generated rollout, one mode per process so the peak
/// RSS is separable:
/// `MAINFRAME_BENCH_MODE=old|new cargo test -p mainframe-adapter-codex --release
///  bench_pr_scan -- --ignored --nocapture` under `/usr/bin/time -l`.
/// With `MAINFRAME_BENCH_MODE=parity` both run and the links are compared.
#[test]
#[ignore = "large synthetic timing run, not for CI"]
fn bench_pr_scan() {
    let mode = std::env::var("MAINFRAME_BENCH_MODE").unwrap_or_else(|_| "parity".into());
    let mb = std::env::var("MAINFRAME_BENCH_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(230);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rollout.jsonl");
    let bytes = write_synthetic(&path, mb);
    let run_old = || {
        let raw = std::fs::read_to_string(&path).unwrap();
        scan_history_for_prs(&convert_rollout_whole_string(&raw, "t"))
    };
    let run_new = || scan_history_for_prs(&convert_rollout_file(&path, "t").unwrap().messages);
    let timed = |name: &str, f: &dyn Fn() -> Vec<mainframe_types::adapter::DetectedPr>| {
        let started = std::time::Instant::now();
        let links = f();
        eprintln!(
            "bench {name} bytes={bytes} links={} elapsed={:?}",
            links.len(),
            started.elapsed()
        );
        links
    };
    match mode.as_str() {
        "old" => drop(timed("old", &run_old)),
        "new" => drop(timed("new", &run_new)),
        _ => {
            let new = timed("new", &run_new);
            let old = timed("old", &run_old);
            assert_eq!(format!("{new:?}"), format!("{old:?}"));
        }
    }
}
