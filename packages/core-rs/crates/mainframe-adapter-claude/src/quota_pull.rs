//! Ported from `packages/core/src/plugins/builtin/claude/quota-pull.ts`.
//!
//! Harvests Claude's plan quota: pulls `/usage`, parses its prose into windows,
//! and stamps the resolved account identity. Identity and usage are read
//! concurrently. The identity is stamped even on an `unknown` parse so the
//! caller can key the blob (and reuse last-known on a transient identity
//! sentinel).

use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::time::Duration;

use mainframe_adapter_api::AdapterError;
use mainframe_types::adapter::ProviderQuota;
use tokio::process::Command;

use crate::quota_parse::parse_claude_usage;
use crate::trust_store::read_claude_account_identity;

const USAGE_TIMEOUT_MS: u64 = 30_000;

type RunUsage = dyn Fn() -> Pin<Box<dyn Future<Output = Result<String, AdapterError>> + Send>> + Send + Sync;
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

pub async fn pull_claude_quota(deps: PullClaudeQuotaDeps<'_>) -> Result<ProviderQuota, AdapterError> {
    let usage_fut = (deps.run_usage)();
    let identity_fut: Pin<Box<dyn Future<Output = String> + Send>> = match deps.read_identity {
        Some(read_identity) => read_identity(),
        None => Box::pin(async { read_claude_account_identity(None).await }),
    };
    let (text, account_identity) = tokio::try_join!(usage_fut, async { Ok::<_, AdapterError>(identity_fut.await) })?;

    let mut quota = parse_claude_usage(&text, deps.now);
    quota.account_identity = Some(account_identity);
    Ok(quota)
}

/// Default `run_usage`: a stateless one-shot `claude -p "/usage"` spawn mirroring
/// the title-generator (stdin closed, no session persistence). Zero model tokens,
/// ~1s. The CLI uses its own auth — no credential handling here.
pub async fn spawn_claude_usage(binary: &str, path: &str) -> Result<String, AdapterError> {
    let run = Command::new(binary)
        .args(["-p", "/usage", "--no-session-persistence", "--output-format", "text"])
        // edition-2024 forbids mutating process env; PATH is threaded explicitly
        // so packaged builds find `claude`, mirroring the title-generator spawn.
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();

    let output = match tokio::time::timeout(Duration::from_millis(USAGE_TIMEOUT_MS), run).await {
        Ok(res) => res.map_err(AdapterError::from)?,
        Err(_) => return Err(AdapterError::Message("claude /usage pull timed out".into())),
    };
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_752_814_800_000; // 2026-07-18T06:00:00Z, before the fixture's reset instants
    const USAGE: &str = "Current session: 19% used \u{b7} resets Jul 18 at 10:10am (Europe/Bucharest)";

    fn run_usage_ok(text: &'static str) -> Box<RunUsage> {
        Box::new(move || Box::pin(async move { Ok(text.to_string()) }))
    }
    fn read_identity_fixed(identity: &'static str) -> Box<ReadIdentity> {
        Box::new(move || Box::pin(async move { identity.to_string() }))
    }

    #[tokio::test]
    async fn parses_the_injected_usage_output_and_stamps_the_resolved_account_identity() {
        let run_usage = run_usage_ok(USAGE);
        let read_identity = read_identity_fixed("uuid-123");
        let quota = pull_claude_quota(PullClaudeQuotaDeps {
            run_usage: &run_usage,
            read_identity: Some(&read_identity),
            now: NOW,
        })
        .await
        .unwrap();

        assert_eq!(quota.status, mainframe_types::adapter::ProviderQuotaStatus::Ok);
        assert_eq!(quota.session.as_ref().unwrap().used_percent, 19.0);
        assert_eq!(quota.account_identity.as_deref(), Some("uuid-123"));
        assert_eq!(quota.observed_at, NOW);
    }

    #[tokio::test]
    async fn stamps_the_identity_even_when_the_provider_parses_to_unknown() {
        let run_usage = run_usage_ok("garbage line");
        let read_identity = read_identity_fixed("unknown");
        let quota = pull_claude_quota(PullClaudeQuotaDeps {
            run_usage: &run_usage,
            read_identity: Some(&read_identity),
            now: NOW,
        })
        .await
        .unwrap();

        assert_eq!(quota.status, mainframe_types::adapter::ProviderQuotaStatus::Unknown);
        assert_eq!(quota.account_identity.as_deref(), Some("unknown"));
    }
}

// PORT STATUS: src/plugins/builtin/claude/quota-pull.ts (44 lines)
// confidence: high
// todos: 0
// notes: `runUsage`/`readIdentity` are injected as boxed async closures (Rust has
// notes: no bare async-fn-value equivalent of the TS deps object) so tests need no
// notes: real spawn or filesystem read, matching the TS seam. `spawnClaudeUsage`
// notes: mirrors title_generator.rs's Command/Stdio/timeout pattern (PATH threaded
// notes: explicitly, kill_on_drop, 30s timeout -> Err on elapse).
