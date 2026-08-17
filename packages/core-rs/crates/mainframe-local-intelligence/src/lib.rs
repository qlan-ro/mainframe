//! On-device generation via Apple's Foundation Models, reached through the
//! bundled `mainframe-intelligence` helper (`packages/apple-intelligence`).
//!
//! Apple's model is Swift-only with no C ABI, so this is a child-process call
//! rather than FFI — the same shape as the CLI title generators it sits in front
//! of. Every failure mode returns `None`, which the caller reads as "fall back to
//! the adapter's own title generation".
//!
//! The helper is located *only* through [`HELPER_BIN_ENV`], which the Tauri shell
//! sets when it finds a bundled binary next to the app executable. There is
//! deliberately no monorepo-path fallback: a dev daemon, the E2E suite, and CI
//! must never reach a real model unless someone opted in explicitly.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use std::process::{Output, Stdio};
use std::time::Duration;

use mainframe_adapter_api::finalize_title;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Absolute path to the `mainframe-intelligence` helper. Unset means no on-device
/// path exists on this machine, which is the normal case off macOS.
pub const HELPER_BIN_ENV: &str = "MAINFRAME_LOCAL_INTELLIGENCE_BIN";

/// The helper's exit code for "Apple Intelligence isn't available here" — a
/// routine machine-state outcome (not eligible, not enabled, still downloading)
/// logged at debug, versus a real fault which is logged at warn.
const EXIT_MODEL_UNAVAILABLE: i32 = 3;

/// On-device generation runs about a second; this only has to catch a wedged
/// child, so it sits far below the 30s the CLI title path allows.
const TIMEOUT: Duration = Duration::from_secs(10);

/// A short chat title generated on-device, or `None` if this machine has no
/// on-device path, the model declined, or the helper failed.
///
/// Callers must pass the same visible message text they would hand a CLI title
/// generator, and must treat `None` as "try the next generator".
pub async fn generate_title(content: &str) -> Option<String> {
    let binary = std::env::var(HELPER_BIN_ENV)
        .ok()
        .filter(|s| !s.is_empty())?;
    generate_title_with(&binary, content, TIMEOUT).await
}

async fn generate_title_with(binary: &str, content: &str, timeout: Duration) -> Option<String> {
    let output = match run_helper(binary, content, timeout).await {
        Ok(output) => output,
        Err(reason) => {
            tracing::warn!(binary, reason, "local title generation failed");
            return None;
        }
    };

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        if output.status.code() == Some(EXIT_MODEL_UNAVAILABLE) {
            tracing::debug!(detail, "local title generation skipped: model unavailable");
        } else {
            tracing::warn!(
                binary,
                status = ?output.status.code(),
                detail,
                "local title generation failed"
            );
        }
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let title = finalize_title(&repair_shouted_title(raw.trim()));
    if title.is_none() {
        tracing::debug!(
            candidate_chars = raw.trim().chars().count(),
            "local title generation produced no usable title"
        );
    }
    title
}

/// Spawn the helper, hand it `content` on stdin, and collect its output under a
/// timeout. `Err` carries a short reason for the log; it never reaches a user.
async fn run_helper(
    binary: &str,
    content: &str,
    timeout: Duration,
) -> Result<Output, &'static str> {
    let mut child = Command::new(binary)
        .arg("title")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "spawn_failed")?;

    // Closing stdin (by dropping the handle) is what tells the helper the message
    // is complete; without it both sides wait forever.
    let mut stdin = child.stdin.take().ok_or("stdin_unavailable")?;
    let written = stdin.write_all(content.as_bytes()).await;
    drop(stdin);
    written.map_err(|_| "stdin_write_failed")?;

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result.map_err(|_| "wait_failed"),
        Err(_) => Err("timed_out"),
    }
}

/// Repair a title the model shouted.
///
/// The on-device model returns ALL CAPS for roughly a third of generations no
/// matter how the instructions forbid it — a 3B model's instruction-following
/// limit, not a prompt that needs more work. Only a title containing no lowercase
/// letter at all is rewritten, so acronyms inside an otherwise mixed-case title
/// ("PR Migration Safety Review") survive untouched.
fn repair_shouted_title(title: &str) -> String {
    if title.chars().any(char::is_lowercase) {
        return title.to_string();
    }
    title
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first
                    .to_uppercase()
                    .chain(chars.flat_map(char::to_lowercase))
                    .collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    /// Generous on purpose: these cases assert an *outcome*, never latency, and a
    /// tight bound turns a loaded CI box into a flake. The one test that asserts
    /// the timeout itself passes its own short duration.
    const UNHURRIED: Duration = Duration::from_secs(10);

    /// A stand-in for the Swift helper. Tests never invoke the real one: it needs
    /// Apple Intelligence enabled, so it would pass on one machine and skip on the
    /// next — and would make the suite's output depend on a model's whims.
    ///
    /// Every fake touches a marker before running `body`, so a test asserting
    /// `None` can also assert the helper actually ran. Without it, each of those
    /// tests would pass just as well if the spawn had silently failed.
    fn fake_helper(dir: &tempfile::TempDir, body: &str) -> String {
        let path = dir.path().join("fake-helper");
        let mut file = std::fs::File::create(&path).unwrap();
        writeln!(file, "#!/bin/sh\ntouch \"$0.ran\"\n{body}").unwrap();
        drop(file);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn did_run(binary: &str) -> bool {
        std::path::Path::new(&format!("{binary}.ran")).exists()
    }

    #[tokio::test]
    async fn returns_the_helpers_title_recased() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_helper(&dir, "echo 'AUTH REFACTOR'");
        assert_eq!(
            generate_title_with(&bin, "refactor the auth module", UNHURRIED).await,
            Some("Auth Refactor".to_string())
        );
    }

    #[tokio::test]
    async fn the_message_reaches_the_helper_on_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_helper(&dir, "cat");
        assert_eq!(
            generate_title_with(&bin, "Fix Login Bug", UNHURRIED).await,
            Some("Fix Login Bug".to_string())
        );
    }

    #[tokio::test]
    async fn model_unavailable_exit_yields_no_title() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_helper(
            &dir,
            "echo 'model unavailable: deviceNotEligible' >&2\nexit 3",
        );
        assert_eq!(generate_title_with(&bin, "anything", UNHURRIED).await, None);
        assert!(did_run(&bin), "the helper should have been spawned");
    }

    #[tokio::test]
    async fn helper_error_yields_no_title() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_helper(&dir, "echo boom >&2\nexit 1");
        assert_eq!(generate_title_with(&bin, "anything", UNHURRIED).await, None);
        assert!(did_run(&bin), "the helper should have been spawned");
    }

    #[tokio::test]
    async fn a_missing_helper_yields_no_title() {
        assert_eq!(
            generate_title_with("/nonexistent/mainframe-intelligence", "anything", UNHURRIED).await,
            None
        );
    }

    #[tokio::test]
    async fn a_wedged_helper_is_abandoned_at_the_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_helper(&dir, "sleep 30");
        assert_eq!(
            generate_title_with(&bin, "anything", Duration::from_millis(150)).await,
            None
        );
    }

    #[tokio::test]
    async fn a_title_rejected_by_the_shared_gate_yields_none() {
        let dir = tempfile::tempdir().unwrap();
        // One character — under `finalize_title`'s floor.
        let bin = fake_helper(&dir, "echo x");
        assert_eq!(generate_title_with(&bin, "anything", UNHURRIED).await, None);
        assert!(did_run(&bin), "the helper should have been spawned");
    }

    /// The whole chain against the real Swift helper and a real on-device model.
    /// Ignored by default because it needs macOS 26, Apple Intelligence switched
    /// on, and a provisioned binary — conditions CI does not have and a
    /// contributor's Mac might not either. Run it deliberately:
    ///
    /// ```text
    /// MAINFRAME_LOCAL_INTELLIGENCE_BIN=$PWD/../../../app-tauri/src-tauri/binaries/mainframe-intelligence-aarch64-apple-darwin \
    ///   cargo test -p mainframe-local-intelligence -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "needs a provisioned helper and Apple Intelligence enabled"]
    async fn the_real_helper_returns_a_usable_title() {
        let title = generate_title(
            "the tour's last step points at nothing after the daemon zone was removed",
        )
        .await
        .expect("the on-device model should have produced a title");
        println!("on-device title: {title}");
        assert!(
            title.chars().any(char::is_lowercase),
            "a shouted title should have been recased, got {title:?}"
        );
    }

    /// `packages/app-tauri/src-tauri` is a separate cargo workspace, so it sets
    /// this variable by literal string rather than by importing the constant.
    /// This assertion and its twin in that crate's `sidecar.rs` tests are the
    /// only thing keeping the two spellings in step; a rename that touches one
    /// side alone would silently switch on-device titles off.
    #[test]
    fn the_env_var_matches_the_name_the_tauri_shell_sets() {
        assert_eq!(HELPER_BIN_ENV, "MAINFRAME_LOCAL_INTELLIGENCE_BIN");
    }

    #[test]
    fn shouted_titles_are_recased() {
        assert_eq!(
            repair_shouted_title("REFACTOR AUTHENTICATION"),
            "Refactor Authentication"
        );
        assert_eq!(repair_shouted_title("BANANA"), "Banana");
    }

    #[test]
    fn titles_with_any_lowercase_are_left_alone() {
        assert_eq!(
            repair_shouted_title("PR Migration Safety Review"),
            "PR Migration Safety Review"
        );
        assert_eq!(
            repair_shouted_title("React.act Not a Function"),
            "React.act Not a Function"
        );
    }

    #[test]
    fn recasing_collapses_the_whitespace_it_splits_on() {
        assert_eq!(repair_shouted_title("FIX  LOGIN\tBUG"), "Fix Login Bug");
    }

    #[test]
    fn non_ascii_lowercase_counts_as_lowercase() {
        assert_eq!(
            repair_shouted_title("рефактор аутентификации"),
            "рефактор аутентификации"
        );
    }
}
