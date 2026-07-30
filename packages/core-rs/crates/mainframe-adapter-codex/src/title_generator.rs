//! One-shot `codex exec` call that turns a first user message into a short chat
//! title — the Codex counterpart of `mainframe-adapter-claude`'s title generator.

use std::process::Stdio;
use std::time::Duration;

use mainframe_adapter_api::{AdapterError, finalize_title};
use tokio::process::Command;

const TITLE_TIMEOUT_MS: u64 = 30_000;

/// One-shot `codex exec` call that turns a first message into a short title.
pub async fn generate_codex_title(
    content: &str,
    binary: &str,
    path: &str,
) -> Result<Option<String>, AdapterError> {
    let message: String = content.chars().take(500).collect();
    let prompt = format!(
        "Generate a short title (2-5 words) for a coding chat that starts with this message.\nRules: Title case. No quotes. No punctuation. Be specific about the task.\nExamples: Auth Refactor, Fix Login Bug, Add Dark Mode Toggle, Optimize DB Queries\n\nMessage: {message}\n\nTitle:"
    );
    // Run from a scratch dir, never the chat's project: `codex` reads AGENTS.md from
    // its cwd, which would bill a whole project preamble against a 5-word title.
    let cwd = std::env::temp_dir();

    let run = Command::new(binary)
        .args(title_args(&prompt, &cwd.to_string_lossy()))
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
                "codex title generation timed out".into(),
            ));
        }
    };

    // A `codex` too old for these flags exits non-zero with `unexpected argument`
    // rather than running the prompt, so a failed exit must not be parsed as a title.
    if !output.status.success() {
        return Err(AdapterError::Message(format!(
            "codex title generation exited with {}",
            output.status
        )));
    }

    Ok(finalize_title(&String::from_utf8_lossy(&output.stdout)))
}

/// `codex exec` args for a throwaway title run. `stdout` is the final message
/// alone (the banner and token accounting go to stderr), so no `--output-last-message`
/// file is needed.
fn title_args<'a>(prompt: &'a str, cwd: &'a str) -> [&'a str; 11] {
    [
        "exec",
        // Leave nothing behind: no rollout file under `sessions/`, no `threads` row
        // in the state DB. Without this every title pollutes the CLI's resume picker
        // (and our external-sessions scan) with a "Generate a short title…" ghost.
        "--ephemeral",
        // Skip `config.toml`: it would boot the user's MCP servers, skills and
        // plugins to name a chat — measured at 20k tokens versus 7k without.
        "--ignore-user-config",
        "--skip-git-repo-check",
        "-C",
        cwd,
        "-s",
        "read-only",
        "--color",
        "never",
        prompt,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_ephemerally_and_ignores_user_config() {
        let args = title_args("Title:", "/tmp");
        assert!(
            args.contains(&"--ephemeral"),
            "dropping --ephemeral leaves a ghost session per title: {args:?}"
        );
        assert!(
            args.contains(&"--ignore-user-config"),
            "dropping --ignore-user-config loads the user's MCP servers to name a chat: {args:?}"
        );
    }

    #[test]
    fn never_writes_from_the_title_run() {
        let args = title_args("Title:", "/tmp");
        let sandbox = args.iter().position(|a| *a == "-s").map(|i| args[i + 1]);
        assert_eq!(sandbox, Some("read-only"));
    }

    #[test]
    fn the_prompt_is_the_final_positional_arg() {
        let args = title_args("Message: hi\n\nTitle:", "/tmp");
        assert_eq!(args.last(), Some(&"Message: hi\n\nTitle:"));
    }

    #[test]
    fn runs_outside_the_project_so_agents_md_is_not_billed() {
        let args = title_args("Title:", "/scratch");
        let cwd = args.iter().position(|a| *a == "-C").map(|i| args[i + 1]);
        assert_eq!(cwd, Some("/scratch"));
    }
}
