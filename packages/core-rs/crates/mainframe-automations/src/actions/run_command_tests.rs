//! T6.3 — run_command: A1 env-injection (hostile chips are inert data),
//! cwd containment, outputAs lines, non-zero exit, output cap.

use serde_json::json;

use crate::tokens::TokenValue;

use super::run_command::{RunCommandAction, compile_script, resolve_cwd_for_test};
use super::{Action, ActionCtx};

fn ctx(project_root: &str) -> ActionCtx {
    ActionCtx {
        creds: None,
        credential_label: None,
        idempotency_key: "run-1:step-1".to_string(),
        project_root: project_root.to_string(),
        worktree_path: None,
    }
}

fn text(value: &TokenValue) -> &str {
    match value {
        TokenValue::Text(s) => s,
        other => panic!("expected text, got {other:?}"),
    }
}

#[test]
fn each_chip_becomes_its_own_quoted_mf_n_env_var() {
    let (script, env) = compile_script(
        &[
            json!({"literal": "echo "}),
            json!({"chip": "a b"}),
            json!({"literal": " "}),
            json!({"chip": "c"}),
        ]
        .iter()
        .map(|v| serde_json::from_value(v.clone()).unwrap())
        .collect::<Vec<_>>(),
    );

    assert_eq!(script, "echo \"$MF_0\" \"$MF_1\"");
    assert_eq!(
        env,
        vec![
            ("MF_0".to_string(), "a b".to_string()),
            ("MF_1".to_string(), "c".to_string()),
        ]
    );
}

#[tokio::test]
async fn hostile_chip_runs_as_literal_data_never_shell_source() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();
    let hostile =
        format!("; touch {root}/pwned; $(touch {root}/pwned2); `touch {root}/pwned3`; echo owned");

    let action = RunCommandAction;
    let params = json!({
        "script": [
            {"literal": "printf 'BEGIN%sEND' "},
            {"chip": hostile},
        ],
        "runIn": "project root",
    });
    let outputs = action.execute(&params, &ctx(&root)).await.unwrap();

    let stdout = text(&outputs["output"]);
    let payload = stdout
        .split("BEGIN")
        .nth(1)
        .and_then(|s| s.split("END").next())
        .unwrap();
    assert_eq!(payload, hostile, "chip must splice as verbatim data");
    for marker in ["pwned", "pwned2", "pwned3"] {
        assert!(
            !dir.path().join(marker).exists(),
            "chip escaped into shell source: {marker} was created"
        );
    }
    assert_eq!(outputs["exitCode"], TokenValue::Number(0.0));
}

#[tokio::test]
async fn output_as_lines_trims_and_drops_blank_lines() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();

    let action = RunCommandAction;
    let params = json!({
        "script": [{"literal": r"printf 'a\n b \n\nc\n'"}],
        "runIn": "project root",
        "outputAs": "lines",
    });
    let outputs = action.execute(&params, &ctx(&root)).await.unwrap();

    assert_eq!(
        outputs["output"],
        TokenValue::List(vec![
            TokenValue::Text("a".to_string()),
            TokenValue::Text("b".to_string()),
            TokenValue::Text("c".to_string()),
        ])
    );
}

#[tokio::test]
async fn nonzero_exit_fails_with_stderr_tail() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();

    let action = RunCommandAction;
    let params = json!({
        "script": [{"literal": "echo boom >&2; exit 3"}],
        "runIn": "project root",
    });
    let err = action.execute(&params, &ctx(&root)).await.unwrap_err();
    assert!(
        err.0.starts_with("run_command exited 3:") && err.0.contains("boom"),
        "unexpected error: {}",
        err.0
    );
}

#[tokio::test]
async fn nonzero_exit_without_stderr_reports_no_output() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();

    let action = RunCommandAction;
    let params = json!({
        "script": [{"literal": "exit 7"}],
        "runIn": "project root",
    });
    let err = action.execute(&params, &ctx(&root)).await.unwrap_err();
    assert_eq!(err.0, "run_command exited 7: (no stderr output)");
}

#[tokio::test]
async fn runaway_output_is_capped_loudly() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();

    let action = RunCommandAction;
    let params = json!({
        // ~9 MB of 'x' — over the 8 MB cap.
        "script": [{"literal": "dd if=/dev/zero bs=1048576 count=9 2>/dev/null | tr '\\0' x"}],
        "runIn": "project root",
    });
    let err = action.execute(&params, &ctx(&root)).await.unwrap_err();
    assert!(
        err.0.contains("output exceeded"),
        "unexpected error: {}",
        err.0
    );
}

#[tokio::test]
async fn cwd_containment_and_worktree_resolution() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("proj");
    let escape = dir.path().join("escape");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::create_dir_all(&escape).unwrap();
    let root_str = root.to_string_lossy().into_owned();

    // project root → ctx.project_root verbatim.
    let cwd = resolve_cwd_for_test(&ctx(&root_str), "project root", None)
        .await
        .unwrap();
    assert_eq!(cwd, root_str);

    // custom inside the root → canonicalized subdir.
    let cwd = resolve_cwd_for_test(&ctx(&root_str), "custom", Some("sub"))
        .await
        .unwrap();
    assert_eq!(
        cwd,
        root.join("sub").canonicalize().unwrap().to_string_lossy()
    );

    // custom escaping the root (exists, but outside) → loud failure.
    let err = resolve_cwd_for_test(&ctx(&root_str), "custom", Some("../escape"))
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "run_command custom cwd '../escape' is outside the project root"
    );

    // worktree mode reads the daemon-computed path directly.
    let mut with_worktree = ctx(&root_str);
    with_worktree.worktree_path = Some("/tmp/wt".to_string());
    let cwd = resolve_cwd_for_test(&with_worktree, "worktree", None)
        .await
        .unwrap();
    assert_eq!(cwd, "/tmp/wt");

    // worktree mode without an active worktree → loud failure.
    let err = resolve_cwd_for_test(&ctx(&root_str), "worktree", None)
        .await
        .unwrap_err();
    assert_eq!(
        err.0,
        "run_command runIn \"worktree\" requested but no worktree is active for this run"
    );
}

#[tokio::test]
async fn invalid_inputs_fail_before_spawning() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().into_owned();
    let action = RunCommandAction;

    // custom without customPath.
    let err = action
        .execute(
            &json!({"script": [{"literal": "true"}], "runIn": "custom"}),
            &ctx(&root),
        )
        .await
        .unwrap_err();
    assert_eq!(err.0, "run_command runIn 'custom' requires customPath");

    // empty script (zod .min(1) parity).
    let err = action
        .execute(&json!({"script": [], "runIn": "project root"}), &ctx(&root))
        .await
        .unwrap_err();
    assert!(err.0.contains("invalid input for 'run_command'"));

    // unknown fields rejected (zod .strict() parity).
    let err = action
        .execute(
            &json!({"script": [{"literal": "true"}], "runIn": "project root", "nope": 1}),
            &ctx(&root),
        )
        .await
        .unwrap_err();
    assert!(err.0.contains("invalid input for 'run_command'"));
}

#[test]
fn manifest_matches_contract() {
    use super::manifest::{ActionOutput, ActionOutputType};
    let manifest = RunCommandAction.manifest();
    assert_eq!(manifest.id, "run_command");
    assert_eq!(
        manifest.outputs,
        vec![
            ActionOutput::new("output", ActionOutputType::Text),
            ActionOutput::new("exitCode", ActionOutputType::Number),
        ]
    );
    assert!(!manifest.idempotent);
}
