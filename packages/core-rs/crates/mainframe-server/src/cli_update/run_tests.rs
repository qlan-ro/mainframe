use super::*;

use std::sync::Mutex;

use mainframe_types::sync::LockExt as _;

fn collecting() -> (OutputSink, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink_lines = lines.clone();
    let sink: OutputSink = Arc::new(move |line| sink_lines.lock_recover().push(line));
    (sink, lines)
}

#[tokio::test]
async fn streams_both_streams_stripped_and_reports_the_exit_code() {
    let (sink, lines) = collecting();
    let outcome = run_update(
        CommandSpec {
            program: "sh".into(),
            args: vec![
                "-c".into(),
                "printf '\\033[32m==> Upgrading\\033[0m\\n'; echo oops >&2; exit 3".into(),
            ],
        },
        &ResolvedPath::from_value("/usr/bin:/bin"),
        sink,
    )
    .await;
    assert_eq!(outcome, RunOutcome::Exited(Some(3)));
    let mut got = lines.lock_recover().clone();
    got.sort();
    assert_eq!(got, ["==> Upgrading", "oops"]);
}

#[tokio::test]
async fn a_missing_program_is_a_spawn_failure() {
    let (sink, _) = collecting();
    let outcome = run_update(
        CommandSpec {
            program: "/nonexistent/brew".into(),
            args: vec![],
        },
        &ResolvedPath::from_value("/usr/bin:/bin"),
        sink,
    )
    .await;
    assert!(matches!(outcome, RunOutcome::SpawnFailed(_)));
}

#[test]
fn permission_heuristic() {
    assert!(looks_like_permission_failure(
        "Error: EACCES: permission denied, mkdir"
    ));
    assert!(looks_like_permission_failure(
        "sudo: a terminal is required to read the password"
    ));
    assert!(looks_like_permission_failure(
        "/usr/local/Cellar is not writable."
    ));
    assert!(!looks_like_permission_failure("npm error 404 Not Found"));
}
