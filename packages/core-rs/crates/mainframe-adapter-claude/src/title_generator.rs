//! Ported from `packages/core/src/plugins/builtin/claude/title-generator.ts`.
//!
//! One-shot Haiku call over the Claude CLI that turns a first user message into a
//! short chat title. Split out of the generic `chat/title-generator` so the owning
//! adapter generates its own titles (#430).

use std::process::Stdio;
use std::time::Duration;

use mainframe_adapter_api::AdapterError;
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
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();

    let output = match tokio::time::timeout(Duration::from_millis(TITLE_TIMEOUT_MS), run).await {
        Ok(res) => res?,
        Err(_) => {
            return Err(AdapterError::Message(
                "claude title generation timed out".into(),
            ));
        }
    };

    Ok(finalize_title(&String::from_utf8_lossy(&output.stdout)))
}

/// `stdout.trim().replace(/^["']|["']$/g, '').trim()`, accepting only a 2..=80 char
/// result (else `null`).
fn finalize_title(stdout: &str) -> Option<String> {
    let mut t = stdout.trim().to_string();
    if t.starts_with('"') || t.starts_with('\'') {
        t.remove(0);
    }
    if t.ends_with('"') || t.ends_with('\'') {
        t.pop();
    }
    let title = t.trim();
    let len = title.chars().count();
    if !title.is_empty() && (2..=80).contains(&len) {
        Some(title.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_surrounding_quotes_and_trims() {
        assert_eq!(
            finalize_title("  \"Auth Refactor\"\n"),
            Some("Auth Refactor".to_string())
        );
        assert_eq!(
            finalize_title("'Fix Login Bug'"),
            Some("Fix Login Bug".to_string())
        );
    }

    #[test]
    fn rejects_too_short_or_too_long() {
        assert_eq!(finalize_title("a"), None);
        assert_eq!(finalize_title("   "), None);
        let long: String = "x".repeat(81);
        assert_eq!(finalize_title(&long), None);
    }
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
// notes: The quote-strip/length gate is factored into finalize_title and unit-tested
// notes: (no TS test covers this module directly).
