//! `ensure_thread`'s `thread/start` vs `thread/resume` decision, split out of
//! `session.rs` so that file's `ensure_thread` stays a single call plus a match
//! instead of carrying this pure decision + its params builder and tests
//! inline.

use serde_json::{Map, Value, json};

use crate::fork::ThreadTarget;

/// The JSON-RPC method + params `ensure_thread` should send, decided purely
/// from whether a resume target exists and whether the spawn is no-persistence.
/// A no-persistence spawn always starts fresh with `ephemeral: true` and never
/// resumes, even when `resume_thread_id` is `Some` — the caller must not be
/// able to leak a resume target into it.
pub(crate) enum ThreadRequest {
    Resume(Map<String, Value>),
    Start(Map<String, Value>),
    /// `thread/fork` — the fork's first spawn when the resolver
    /// picks `ThreadTarget::Fork`. Answers with the same `{ thread: { id },
    /// model }` shape plus an optional `thread.forkedFromId`.
    Fork(Map<String, Value>),
}

impl ThreadRequest {
    /// The JSON-RPC method this request sends. `ensure_thread` uses this plus
    /// [`Self::into_params`] to make a single `client.request(..)` call instead
    /// of matching per variant — `thread/start`, `thread/resume` and
    /// `thread/fork` all answer with the same `{ thread: { id }, model }` shape
    /// (`ThreadStartResult`).
    pub(crate) fn method(&self) -> &'static str {
        match self {
            ThreadRequest::Resume(_) => "thread/resume",
            ThreadRequest::Start(_) => "thread/start",
            ThreadRequest::Fork(_) => "thread/fork",
        }
    }

    /// The request params, regardless of variant.
    pub(crate) fn into_params(self) -> Map<String, Value> {
        match self {
            ThreadRequest::Resume(p) | ThreadRequest::Start(p) | ThreadRequest::Fork(p) => p,
        }
    }
}

/// `thread/fork` params: only `threadId` is required; `lastTurnId` forks
/// "through, inclusive" when present. Every override field (`cwd`, `model`,
/// `sandbox`, `approvalPolicy`…) is deliberately omitted so the fork inherits
/// the parent's — omission reads as inherit, not reset (verified live), and
/// `turn/start` re-supplies policy and model on every turn anyway
/// (CONSUMED-SURFACE CODEX-RPC-03). No `ephemeral`, no `excludeTurns`.
pub(crate) fn build_fork_request(
    source_thread_id: &str,
    last_turn_id: Option<&str>,
) -> ThreadRequest {
    let mut p = Map::new();
    p.insert("threadId".into(), json!(source_thread_id));
    if let Some(id) = last_turn_id {
        p.insert("lastTurnId".into(), json!(id));
    }
    p.insert("persistExtendedHistory".into(), json!(true));
    p.insert("persistFullHistory".into(), json!(true));
    ThreadRequest::Fork(p)
}

/// Builds `ensure_thread`'s request for a resolved `ThreadTarget`, plus the
/// fork source id to verify the response's `forkedFromId` against (`None` for a
/// non-fork target). Keeps `session.rs`'s `ensure_thread` to a single call site
/// instead of matching on `ThreadTarget` inline.
pub(crate) fn thread_request_for(
    target: ThreadTarget,
    no_persistence: bool,
    base: Map<String, Value>,
    approval_policy: &str,
    sandbox: Value,
) -> (ThreadRequest, Option<String>) {
    match target {
        ThreadTarget::Fork {
            source_id,
            last_turn_id,
        } => {
            let request = build_fork_request(&source_id, last_turn_id.as_deref());
            (request, Some(source_id))
        }
        ThreadTarget::Resume(id) => (
            build_thread_request(Some(&id), no_persistence, base, approval_policy, sandbox),
            None,
        ),
        ThreadTarget::Start => (
            build_thread_request(None, no_persistence, base, approval_policy, sandbox),
            None,
        ),
    }
}

/// Pure decision + params builder shared by `ensure_thread`'s `thread/start`
/// and `thread/resume` calls. `base` is the shared cwd/persist-history/model
/// map from `CodexSession::thread_params_base`.
pub(crate) fn build_thread_request(
    resume_thread_id: Option<&str>,
    no_persistence: bool,
    base: Map<String, Value>,
    approval_policy: &str,
    sandbox: Value,
) -> ThreadRequest {
    if !no_persistence && let Some(resume) = resume_thread_id {
        let mut p = base;
        p.insert("threadId".into(), json!(resume));
        return ThreadRequest::Resume(p);
    }
    let mut p = base;
    p.insert("approvalPolicy".into(), json!(approval_policy));
    p.insert("sandbox".into(), sandbox);
    p.insert("experimentalRawEvents".into(), json!(true));
    if no_persistence {
        // Codex's native no-vendor-transcript mechanism (verified interactively on
        // 0.155.1 alongside persistExtendedHistory/persistFullHistory).
        p.insert("ephemeral".into(), json!(true));
    }
    ThreadRequest::Start(p)
}

#[cfg(test)]
#[path = "thread_request_tests.rs"]
mod tests;
