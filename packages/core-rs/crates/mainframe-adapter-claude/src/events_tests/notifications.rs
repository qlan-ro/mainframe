use super::super::*;
use super::*;
#[tokio::test]
async fn task_updated_with_a_terminal_status_ends_the_task() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "mf-chat-8".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        tracker.clone(),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "init", "session_id": "claude-session-u" }),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "task_started", "task_id": "task-u", "tool_use_id": "tu-u", "description": "bg agent", "task_type": "local_agent" }),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "task_updated", "task_id": "task-u", "status": "running", "patch": { "status": "failed" } }),
    );
    assert_eq!(
        tracker.get("mf-chat-8", "task-u").unwrap().status,
        mainframe_types::background_task::BackgroundTaskStatus::Failed
    );
}

#[test]
fn push_notification_tool_call_fires_one_attention_request() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "assistant", "message": { "content": [
            { "type": "tool_use", "id": "tu_1", "name": "PushNotification", "input": { "message": "need your input" } }
        ] } }),
    );
    assert_eq!(sink.r().attention_requests, vec!["need your input"]);
}

#[tokio::test]
async fn task_notification_reflects_completion_under_mainframe_chat_id() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "mf-chat-99".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        tracker.clone(),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "init", "session_id": "claude-session-xyz" }),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "task_started", "task_id": "task-2", "tool_use_id": "tu-2", "description": "build project" }),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "task_notification", "task_id": "task-2", "status": "completed", "summary": "Done" }),
    );
    let tasks = tracker.list("mf-chat-99");
    assert_eq!(tasks.len(), 1);
    assert_eq!(
        tasks[0].status,
        mainframe_types::background_task::BackgroundTaskStatus::Completed
    );
    assert!(tracker.list("claude-session-xyz").is_empty());
}

#[test]
fn push_notification_without_a_string_message_records_nothing_but_still_messages() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "assistant", "message": { "content": [
            { "type": "tool_use", "id": "tu_1", "name": "PushNotification", "input": { "message": 42 } }
        ] } }),
    );
    assert!(sink.r().attention_requests.is_empty());
    assert!(sink.r().messages >= 1);
}

#[test]
fn task_started_threads_task_type_through_to_the_tracked_kind() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "mf-chat-7".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        tracker.clone(),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "init", "session_id": "claude-session-k" }),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "task_started", "task_id": "agent-1", "tool_use_id": "tu-a", "description": "reviewer subagent", "task_type": "local_agent" }),
    );
    assert_eq!(
        tracker.get("mf-chat-7", "agent-1").unwrap().kind,
        mainframe_types::background_task::BackgroundWorkKind::Agent
    );
}

#[test]
fn todo_write_fires_todo_update() {
    let s = session();
    let sink = RecordingSink::default();
    let todos = serde_json::json!([
        { "content": "Write tests", "status": "in_progress", "activeForm": "Writing tests" },
        { "content": "Implement feature", "status": "pending", "activeForm": "Implementing feature" }
    ]);
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "assistant", "message": { "content": [ { "type": "tool_use", "id": "tu_1", "name": "TodoWrite", "input": { "todos": todos } } ] } }),
    );
    assert_eq!(sink.r().todos.len(), 1);
    assert_eq!(sink.r().todos[0].len(), 2);
    assert!(sink.r().messages >= 1);
}

#[test]
fn no_push_notification_tool_records_nothing() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "assistant", "message": { "content": [
            { "type": "tool_use", "id": "tu_1", "name": "Read", "input": { "file_path": "/foo.ts" } }
        ] } }),
    );
    assert!(sink.r().attention_requests.is_empty());
}

#[test]
fn rate_limit_event_emits_a_normalized_provider_quota_via_on_provider_quota() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "rate_limit_event",
            "rate_limit_info": { "rateLimitType": "five_hour", "utilization": 0.42, "resetsAt": 1_789_999_999i64 },
        }),
    );
    let rec = sink.r();
    assert_eq!(rec.provider_quota.len(), 1);
    let (adapter_id, quota) = &rec.provider_quota[0];
    assert_eq!(adapter_id, "claude");
    let session = quota.session.as_ref().unwrap();
    assert_eq!(
        session.kind,
        mainframe_types::adapter::QuotaWindowKind::Session
    );
    assert_eq!(session.used_percent, 42.0);
    assert_eq!(session.resets_at, Some(1_789_999_999_000));
    assert_eq!(session.label, None);
    assert!(session.observed_at.is_some());
}

#[test]
fn rate_limit_event_without_usable_utilization_emits_nothing() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "rate_limit_event",
            "rate_limit_info": { "status": "allowed", "rateLimitType": "five_hour" },
        }),
    );
    assert!(sink.r().provider_quota.is_empty());
}

#[test]
fn non_todo_write_does_not_fire_todo_update() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "assistant", "message": { "content": [ { "type": "tool_use", "id": "tu_1", "name": "Read", "input": { "file_path": "/foo.ts" } } ] } }),
    );
    assert!(sink.r().todos.is_empty());
    assert!(sink.r().messages >= 1);
}

#[test]
fn task_started_lands_in_tracker_under_mainframe_chat_id() {
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let s = Arc::new(ClaudeSession::new(
        SessionOptions {
            project_path: "/tmp".to_string(),
            chat_id: None,
            mainframe_chat_id: "mf-chat-42".to_string(),
            session_file_path: None,
            fork_source: None,
        },
        None,
        tracker.clone(),
        Arc::new(ClaudeWorkflowStore::new()),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    ));
    s.init_weak();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "init", "session_id": "claude-session-abc" }),
    );
    assert_eq!(s.chat_id(), "claude-session-abc");
    assert_eq!(s.mainframe_chat_id(), "mf-chat-42");
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "task_started", "task_id": "task-1", "tool_use_id": "tu-1", "description": "sleep 5" }),
    );
    assert_eq!(tracker.list("mf-chat-42").len(), 1);
    assert!(tracker.list("claude-session-abc").is_empty());
}

#[test]
fn rate_limit_event_from_an_endpoint_session_is_not_reported_as_claude_quota() {
    let s = session();
    s.set_endpoint_for_test();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "rate_limit_event",
            "rate_limit_info": { "rateLimitType": "five_hour", "utilization": 0.42, "resetsAt": 1_789_999_999i64 },
        }),
    );
    assert!(sink.r().provider_quota.is_empty());
}
