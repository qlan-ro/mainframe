//! `ensure_thread`'s `thread/start` vs `thread/resume` decision (todo #346, AC 3),
//! split out of `session.rs` so that file's `ensure_thread` stays a single call
//! plus a match instead of carrying this pure decision + its params builder and
//! tests inline.

use serde_json::{Map, Value, json};

use crate::fork::ThreadTarget;

/// The JSON-RPC method + params `ensure_thread` should send, decided purely
/// from whether a resume target exists and whether the spawn is no-persistence
/// (todo #346, AC 3). A no-persistence spawn always starts fresh with
/// `ephemeral: true` and never resumes, even when `resume_thread_id` is
/// `Some` — the caller must not be able to leak a resume target into it.
pub(crate) enum ThreadRequest {
    Resume(Map<String, Value>),
    Start(Map<String, Value>),
    /// `thread/fork` (todo #368) — the fork's first spawn when the resolver
    /// picks `ThreadTarget::Fork`. Answers with the same `{ thread: { id },
    /// model }` shape plus an optional `thread.forkedFromId`.
    Fork(Map<String, Value>),
}

impl ThreadRequest {
    /// The JSON-RPC method this request sends. `ensure_thread` uses this plus
    /// [`Self::into_params`] to make a single `client.request(..)` call
    /// instead of matching per variant (todo #346 review fix) —
    /// `thread/start`, `thread/resume` and `thread/fork` all answer with the
    /// same `{ thread: { id }, model }` shape (`ThreadStartResult`).
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

/// `thread/fork` params (todo #368, Established facts + Gate 0): only
/// `threadId` is required; `lastTurnId` forks "through, inclusive" when
/// present. Every override field (`cwd`, `model`, `sandbox`,
/// `approvalPolicy`…) is deliberately omitted so the fork inherits the
/// parent's — Gate 0 confirmed omission reads as inherit, not reset, and
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
/// fork source id to verify the response's `forkedFromId` against (`None` for
/// a non-fork target) — todo #368. Keeps `session.rs`'s `ensure_thread` to a
/// single call site instead of matching on `ThreadTarget` inline.
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
/// and `thread/resume` calls (todo #346, AC 3). `base` is the shared
/// cwd/persist-history/model map from `CodexSession::thread_params_base`.
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
        // Codex's native no-vendor-transcript mechanism (todo #346 spike, verified
        // interactively on 0.155.1 alongside persistExtendedHistory/persistFullHistory).
        p.insert("ephemeral".into(), json!(true));
    }
    ThreadRequest::Start(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_params() -> Map<String, Value> {
        let mut p = Map::new();
        p.insert("cwd".into(), json!("/tmp/proj"));
        p.insert("persistExtendedHistory".into(), json!(true));
        p.insert("persistFullHistory".into(), json!(true));
        p
    }

    fn params_of(req: ThreadRequest) -> Map<String, Value> {
        match req {
            ThreadRequest::Resume(p) | ThreadRequest::Start(p) | ThreadRequest::Fork(p) => p,
        }
    }

    #[test]
    fn normal_spawn_with_no_resume_id_starts_without_ephemeral() {
        let req = build_thread_request(
            None,
            false,
            base_params(),
            "on-request",
            json!("workspace-write"),
        );
        assert!(matches!(req, ThreadRequest::Start(_)));
        let p = params_of(req);
        assert!(!p.contains_key("ephemeral"));
        assert!(!p.contains_key("threadId"));
    }

    #[test]
    fn normal_spawn_with_a_resume_id_resumes() {
        let req = build_thread_request(
            Some("thread-1"),
            false,
            base_params(),
            "on-request",
            json!("workspace-write"),
        );
        assert!(matches!(req, ThreadRequest::Resume(_)));
        let p = params_of(req);
        assert_eq!(p["threadId"], json!("thread-1"));
        assert!(!p.contains_key("ephemeral"));
    }

    #[test]
    fn no_persistence_spawn_starts_fresh_with_ephemeral_true() {
        let req = build_thread_request(
            None,
            true,
            base_params(),
            "on-request",
            json!("workspace-write"),
        );
        assert!(matches!(req, ThreadRequest::Start(_)));
        let p = params_of(req);
        assert_eq!(p["ephemeral"], json!(true));
        assert!(!p.contains_key("threadId"));
    }

    #[test]
    fn no_persistence_spawn_never_resumes_even_with_a_resume_id_supplied() {
        let req = build_thread_request(
            Some("thread-1"),
            true,
            base_params(),
            "on-request",
            json!("workspace-write"),
        );
        assert!(matches!(req, ThreadRequest::Start(_)));
        let p = params_of(req);
        assert_eq!(p["ephemeral"], json!(true));
        assert!(!p.contains_key("threadId"));
    }

    #[test]
    fn no_persistence_spawn_keeps_the_persist_history_params() {
        let req = build_thread_request(
            None,
            true,
            base_params(),
            "on-request",
            json!("workspace-write"),
        );
        let p = params_of(req);
        assert_eq!(p["persistExtendedHistory"], json!(true));
        assert_eq!(p["persistFullHistory"], json!(true));
    }

    // ---- build_fork_request (todo #368) ----

    #[test]
    fn fork_request_sends_the_source_thread_id_and_persist_flags_with_no_last_turn_id() {
        let req = build_fork_request("parent-thread", None);
        assert_eq!(req.method(), "thread/fork");
        let p = params_of(req);
        assert_eq!(p["threadId"], json!("parent-thread"));
        assert!(!p.contains_key("lastTurnId"));
        assert_eq!(p["persistExtendedHistory"], json!(true));
        assert_eq!(p["persistFullHistory"], json!(true));
    }

    #[test]
    fn fork_request_includes_last_turn_id_when_present() {
        let req = build_fork_request("parent-thread", Some("turn-9"));
        let p = params_of(req);
        assert_eq!(p["lastTurnId"], json!("turn-9"));
    }

    #[test]
    fn fork_request_omits_every_override_field() {
        let p = params_of(build_fork_request("parent-thread", None));
        for key in [
            "cwd",
            "model",
            "sandbox",
            "approvalPolicy",
            "ephemeral",
            "excludeTurns",
        ] {
            assert!(!p.contains_key(key), "fork request must omit {key}");
        }
    }
}

// PORT STATUS: NEW module, split out of session.rs (todo #346 review fix)
// confidence: high
// todos: 0
// notes: pure split, no behavior change — `ensure_thread` calls
// `build_thread_request` exactly as before; only the enum/fn/tests moved.
