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

// ---- build_fork_request ----

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
