use std::collections::HashMap;
use std::path::PathBuf;

use mainframe_types::transcript::TranscriptLocation;

use crate::thread_registry::{AgentMetadata, lookup_agent_metadata};

/// Registry lookup — injectable for tests; defaults to Codex's state DB.
/// `Send + Sync` so the `Adapter::locate_transcript` override yields a `Send`
/// future (the trait boxes futures as `Send`).
pub type LookupFn<'a> = dyn Fn(&[String]) -> HashMap<String, AgentMetadata> + Send + Sync + 'a;

#[derive(Default)]
pub struct CodexTranscriptDeps<'a> {
    /// Registry lookup — injectable for tests; defaults to `lookup_agent_metadata`.
    pub lookup: Option<&'a LookupFn<'a>>,
    /// Sessions root the rollout must live under — injectable for tests.
    pub sessions_root: Option<PathBuf>,
}

/// `~/.codex/sessions`.
fn default_sessions_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("sessions"))
}

/// Codex's transcript location for `thread_id`. Returns `None` (cannot
/// determine — don't flag) when the state DB has no row, the row carries no
/// rollout path, or the path escapes `~/.codex/sessions` (untrusted input,
/// mirrors rollout-reader.rs containment). `Some(Missing)` when the rollout
/// file was deleted, `Some(Present(path))` when it is present and contained.
pub(crate) async fn locate_codex_transcript(
    thread_id: &str,
    deps: Option<&CodexTranscriptDeps<'_>>,
) -> Option<TranscriptLocation> {
    let ids = [thread_id.to_string()];
    let metadata = match deps.and_then(|d| d.lookup) {
        Some(lookup) => lookup(&ids),
        None => lookup_agent_metadata(&ids),
    };
    let rollout_path = metadata.get(thread_id).and_then(|m| m.rollout_path.clone());
    let rollout_path = match rollout_path {
        Some(p) if !p.is_empty() => p,
        _ => return None,
    };

    let resolved = match tokio::fs::canonicalize(&rollout_path).await {
        Ok(p) => p,
        // Expected: rollout file deleted.
        Err(_) => return Some(TranscriptLocation::Missing),
    };

    let root_base = deps
        .and_then(|d| d.sessions_root.clone())
        .or_else(default_sessions_root)?;
    // Expected: root may not exist yet — compare against the literal path.
    let root_resolved = tokio::fs::canonicalize(&root_base)
        .await
        .unwrap_or(root_base);
    if !resolved.starts_with(&root_resolved) {
        return None;
    }
    Some(TranscriptLocation::Present(
        resolved.to_string_lossy().into_owned(),
    ))
}

#[cfg(test)]
#[path = "transcript_tests.rs"]
mod tests;
