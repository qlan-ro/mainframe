//! Ported from `packages/core/src/chat/title-generator.ts`.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

pub fn derive_title_from_message(content: &str) -> String {
    let cleaned = collapse_whitespace(content);
    let chars: Vec<char> = cleaned.chars().collect();
    if chars.len() <= 50 {
        return cleaned;
    }
    let truncated = &chars[..50];
    let last_space = truncated.iter().rposition(|c| *c == ' ');
    let head: String = match last_space {
        Some(idx) if idx > 20 => truncated[..idx].iter().collect(),
        _ => truncated.iter().collect(),
    };
    format!("{head}\u{2026}")
}

pub async fn generate_title(
    content: &str,
    binary: &str,
    path: &str,
) -> std::io::Result<Option<String>> {
    let message: String = content.chars().take(500).collect();
    let prompt = format!(
        "Generate a short title (2-5 words) for a coding chat that starts with this message.\nRules: Title case. No quotes. No punctuation. Be specific about the task.\nExamples: Auth Refactor, Fix Login Bug, Add Dark Mode Toggle, Optimize DB Queries\n\nMessage: {message}\n\nTitle:"
    );

    let mut cmd = Command::new(binary);
    cmd.args([
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
    .env("PATH", path)
    .env("NO_COLOR", "1")
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let child = cmd.spawn()?;
    let output = match timeout(Duration::from_secs(30), child.wait_with_output()).await {
        Ok(result) => result?,
        Err(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "title generation timed out",
            ));
        }
    };

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut title = raw.trim().to_string();
    if title.starts_with('"') || title.starts_with('\'') {
        title.remove(0);
    }
    if title.ends_with('"') || title.ends_with('\'') {
        title.pop();
    }
    let title = title.trim();
    let len = title.chars().count();
    if !title.is_empty() && (2..=80).contains(&len) {
        return Ok(Some(title.to_string()));
    }
    Ok(None)
}

/// `content.replace(/\s+/g, ' ').trim()` — collapse whitespace runs to a single
/// space and trim.
fn collapse_whitespace(content: &str) -> String {
    let mut out = String::new();
    let mut prev_ws = false;
    for c in content.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(c);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_message_is_returned_verbatim_after_collapse() {
        assert_eq!(
            derive_title_from_message("  Fix   the  bug  "),
            "Fix the bug"
        );
    }

    #[test]
    fn long_message_truncates_at_a_word_boundary_with_ellipsis() {
        let input =
            "Refactor the authentication layer and migrate every provider to the new token flow";
        let out = derive_title_from_message(input);
        assert!(out.ends_with('\u{2026}'));
        assert!(out.chars().count() <= 51);
        assert!(!out.contains("  "));
    }
}

// PORT STATUS: src/chat/title-generator.ts (55 lines)
// confidence: high
// todos: 0
// notes: `execFile` + `cp.stdin?.end()` → `tokio::process::Command` with
// notes: `stdin(null)` + `kill_on_drop(true)`; the 30s timeout wraps
// notes: `wait_with_output` (timeout drops the future → kill). spawn argv, the
// notes: `--no-session-persistence` flag, `--model claude-haiku-4-5-20251001`,
// notes: `--max-turns 1`, and `NO_COLOR=1` are copied verbatim. exec errors surface
// notes: as `io::Error` (TS throws → caller `.catch`es). String slicing uses `chars`
// notes: (Rust scalar) vs TS UTF-16 units — divergence only on astral-plane input.
