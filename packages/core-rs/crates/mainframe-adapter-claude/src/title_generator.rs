//! Ported from `packages/core/src/plugins/builtin/claude/title-generator.ts`.
//!
//! One-shot Haiku call over the Claude CLI that turns a first user message into a
//! short chat title. Split out of the generic `chat/title-generator` so the owning
//! adapter generates its own titles (#430).

use std::process::Stdio;
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, finalize_title};
use tokio::process::Command;

const TITLE_TIMEOUT_MS: u64 = 30_000;

/// One-shot Haiku call over the Claude CLI that turns a first message into a short title.
pub async fn generate_claude_title(
    content: &str,
    binary: &str,
    path: &str,
) -> Result<Option<String>, AdapterError> {
    let message: String = content.chars().take(500).collect();
    let prompt = format!(
        "Generate a short title (2-5 words) for a coding chat that starts with this message.\nRules: Title case. No quotes. No punctuation. Be specific about the task.\nExamples: Auth Refactor, Fix Login Bug, Add Dark Mode Toggle, Optimize DB Queries\n\nMessage: {message}\n\nTitle:"
    );

    let run = Command::new(binary)
        .args([
            "-p",
            &prompt,
            // Don't persist this throwaway prompt as a resumable session on disk —
            // otherwise it pollutes the CLI's session list (and our external-sessions
            // scan) as a "Generate a short title…" ghost. The CLI's own title gen
            // avoids this by calling the API directly; we shell out, so we opt out here.
            "--no-session-persistence",
            "--output-format",
            "text",
            "--model",
            "claude-haiku-4-5-20251001",
            "--max-turns",
            "1",
        ])
        // TS `env: { ...process.env, NO_COLOR: '1' }`; PATH is threaded explicitly
        // (edition-2024 forbids mutating process env) so packaged builds find `claude`.
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output();

    let output = match tokio::time::timeout(Duration::from_millis(TITLE_TIMEOUT_MS), run).await {
        Ok(res) => res.map_err(|err| {
            AdapterError::Message(format!("failed to spawn title binary {binary}: {err}"))
        })?,
        Err(_) => {
            return Err(AdapterError::Message(
                "claude title generation timed out".into(),
            ));
        }
    };

    interpret_output(output, binary)
}

/// Turns a completed title-child `Output` into the accepted title, or an error
/// that names the exit status and the CLI's own (bounded) stderr.
fn interpret_output(
    output: std::process::Output,
    binary: &str,
) -> Result<Option<String>, AdapterError> {
    if !output.status.success() {
        let status = output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let stderr = truncate_stderr(&output.stderr);
        let stderr = if stderr.is_empty() {
            "<no stderr>".to_string()
        } else {
            stderr
        };
        return Err(AdapterError::Message(format!(
            "claude title generation exited with {status}: {stderr}"
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout.trim();
    let candidate_chars = stdout.chars().count();
    let title = finalize_title(stdout);
    if title.is_none() {
        tracing::debug!(
            adapter_id = "claude",
            reason = "candidate_rejected",
            binary,
            candidate_chars,
            "title generation skipped"
        );
    }
    Ok(title)
}

/// Bounds the CLI's stderr to 1024 *characters* (not bytes, so a multibyte code
/// point is never split), appending `…` when the source was longer.
fn truncate_stderr(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let text = text.trim();
    let mut truncated: String = text.chars().take(1024).collect();
    if text.chars().count() > 1024 {
        truncated.push('…');
    }
    truncated
}

// PORT STATUS: src/plugins/builtin/claude/title-generator.ts (48 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#430). generateClaudeTitle moved out of chat/title-generator.
// notes: execFileNoStdin → tokio Command with Stdio::null stdin (closes it, mirroring
// notes: `cp.stdin?.end()`). 30s timeout via tokio::time::timeout → Err on elapse
// notes: (TS execFile rejects on timeout; callers keep the deterministic title). PATH
// notes: threaded explicitly + NO_COLOR=1 (edition-2024 can't mutate process env).
// notes: maxBuffer:8192 dropped (title output is a few words; unbounded read is safe).
// notes: stderr is piped (not nulled) and capped at 1024 chars in the returned error;
// notes: a non-zero exit is now Err, not an empty Ok(None) (#287).
// notes: The quote-strip/length gate moved to mainframe_adapter_api::finalize_title
// notes: (#275) so the Codex generator can't drift from it; tests moved with it.
