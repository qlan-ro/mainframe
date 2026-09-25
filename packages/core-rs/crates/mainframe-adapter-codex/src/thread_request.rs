//! `ensure_thread`'s `thread/start` vs `thread/resume` decision (todo #346, AC 3),
//! split out of `session.rs` so that file's `ensure_thread` stays a single call
//! plus a match instead of carrying this pure decision + its params builder and
//! tests inline.

use serde_json::{Map, Value, json};

/// The JSON-RPC method + params `ensure_thread` should send, decided purely
/// from whether a resume target exists and whether the spawn is no-persistence
/// (todo #346, AC 3). A no-persistence spawn always starts fresh with
/// `ephemeral: true` and never resumes, even when `resume_thread_id` is
/// `Some` — the caller must not be able to leak a resume target into it.
pub(crate) enum ThreadRequest {
    Resume(Map<String, Value>),
    Start(Map<String, Value>),
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
            ThreadRequest::Resume(p) => p,
            ThreadRequest::Start(p) => p,
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
}

// PORT STATUS: NEW module, split out of session.rs (todo #346 review fix)
// confidence: high
// todos: 0
// notes: pure split, no behavior change — `ensure_thread` calls
// `build_thread_request` exactly as before; only the enum/fn/tests moved.
