//! Harvests Claude's plan quota: pulls `/usage`, parses its prose into windows,
//! and stamps the resolved account identity. Identity and usage are read
//! concurrently. The identity is stamped even on an `unknown` parse so the
//! caller can key the blob (and reuse last-known on a transient identity
//! sentinel).

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use mainframe_adapter_api::AdapterError;
use mainframe_types::adapter::ProviderQuota;
use tokio::process::Command;

use crate::quota_parse::parse_claude_usage;
use crate::trust_store::read_claude_account_identity;

const USAGE_TIMEOUT_MS: u64 = 30_000;

type RunUsage =
    dyn Fn() -> Pin<Box<dyn Future<Output = Result<String, AdapterError>> + Send>> + Send + Sync;
type ReadIdentity = dyn Fn() -> Pin<Box<dyn Future<Output = String> + Send>> + Send + Sync;

/// Injected dependencies so tests need no real spawn / filesystem read.
pub struct PullClaudeQuotaDeps<'a> {
    /// Returns the raw stdout of `claude -p "/usage"`.
    pub run_usage: &'a RunUsage,
    /// Resolves the account identity (uuid/email/sentinel). `None` uses the
    /// `~/.claude.json` reader.
    pub read_identity: Option<&'a ReadIdentity>,
    pub now: i64,
}

pub async fn pull_claude_quota(
    deps: PullClaudeQuotaDeps<'_>,
) -> Result<ProviderQuota, AdapterError> {
    let usage_fut = (deps.run_usage)();
    let identity_fut: Pin<Box<dyn Future<Output = String> + Send>> = match deps.read_identity {
        Some(read_identity) => read_identity(),
        None => Box::pin(async { read_claude_account_identity(None).await }),
    };
    let (text, account_identity) = tokio::try_join!(usage_fut, async {
        Ok::<_, AdapterError>(identity_fut.await)
    })?;

    let mut quota = parse_claude_usage(&text, deps.now);
    quota.account_identity = Some(account_identity);
    Ok(quota)
}

/// How much of stderr to surface on a nonzero exit — enough to diagnose without
/// bloating the log line.
const STDERR_SNIPPET_LEN: usize = 500;

/// Default `run_usage`: a stateless one-shot `claude -p "/usage"` spawn mirroring
/// the title-generator (stdin closed, no session persistence). Zero model tokens,
/// ~1s. The CLI uses its own auth — no credential handling here.
pub async fn spawn_claude_usage(binary: &str, path: &str) -> Result<String, AdapterError> {
    let mut command = Command::new(binary);
    command
        .args([
            "-p",
            "/usage",
            "--no-session-persistence",
            "--output-format",
            "text",
        ])
        // edition-2024 forbids mutating process env; PATH is threaded explicitly
        // so packaged builds find `claude`, mirroring the title-generator spawn.
        .env("PATH", path)
        .env("NO_COLOR", "1");

    let output = mainframe_runtime::process::run_captured(
        command,
        Some(Duration::from_millis(USAGE_TIMEOUT_MS)),
    )
    .await
    .map_err(|error| match error {
        mainframe_runtime::process::ExecError::Timeout => {
            AdapterError::Timeout("claude /usage pull timed out")
        }
        mainframe_runtime::process::ExecError::Spawn(error)
        | mainframe_runtime::process::ExecError::Io(error) => AdapterError::from(error),
        error => AdapterError::Exec(error),
    })?;

    usage_output_to_result(
        output.status.success(),
        output.status.code(),
        &output.stdout,
        &output.stderr,
    )
}

/// Maps a finished `claude -p "/usage"` process to its stdout, or an `Err` on a
/// nonzero exit. Failing (rather than returning empty stdout) is load-bearing: an
/// `Ok("")` parses fail-closed and would ingest as a successful pull, wiping the
/// last-known quota. Returning `Err` routes the manager into keep-last-known
/// backoff instead (#268 F1).
fn usage_output_to_result(
    success: bool,
    code: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<String, AdapterError> {
    if success {
        return Ok(String::from_utf8_lossy(stdout).into_owned());
    }
    let snippet: String = String::from_utf8_lossy(stderr)
        .trim()
        .chars()
        .take(STDERR_SNIPPET_LEN)
        .collect();
    let code = code.map_or_else(|| "signal".to_string(), |c| c.to_string());
    Err(AdapterError::Exited {
        what: "claude /usage pull",
        detail: format!("code {code}: {snippet}"),
    })
}

#[cfg(test)]
#[path = "quota_pull_tests.rs"]
mod tests;
