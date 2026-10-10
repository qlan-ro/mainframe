use super::*;
pub(super) fn handle_system_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let subtype = event.get("subtype").and_then(Value::as_str);
    match subtype {
        Some("init") => handle_init(session, event, sink),
        Some("compact_boundary") => {
            sink.on_compact(event.get("uuid").and_then(Value::as_str));
        }
        Some("api_error") => handle_retry(session, event, sink),
        Some("task_started") => handle_task_started(session, event, sink),
        Some("task_updated") => handle_task_updated(session, event, sink),
        Some("task_notification") => handle_task_notification(session, event, sink),
        Some("status") if event.get("status").and_then(Value::as_str) == Some("compacting") => {
            sink.on_compact_start();
        }
        Some("task_progress") => {
            let st = session.state.lock_recover();
            crate::workflow_events::handle_task_progress(&st, event);
        }
        _ => {}
    }
}

fn handle_init(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let session_id = event
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    session.state.lock_recover().chat_id = session_id.clone();
    session.set_status(mainframe_types::adapter::AdapterProcessStatus::Ready);
    sink.on_init(&session_id);
}

fn handle_retry(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    session.state.lock_recover().presentation.invalidate(sink);
    let attempt = event
        .get("retryAttempt")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let reason = event
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string);
    session.state.lock_recover().partial.clear();
    sink.on_api_retry(attempt, reason);
}

fn handle_task_started(session: &ClaudeSession, event: &Value, _sink: &dyn SessionSink) {
    let mut st = session.state.lock_recover();
    let task_id = event
        .get("task_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    st.active_tasks.insert(
        task_id.clone(),
        crate::session::ActiveTask {
            task_type: event
                .get("task_type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            command: event
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
    );
    if !st.mainframe_chat_id.is_empty() {
        let chat_id = st.mainframe_chat_id.clone();
        let claude_session_id = st.chat_id.clone();
        let real_cwd = st.real_project_path.clone();
        st.task_events.handle_task_started(
            &chat_id,
            task_started_payload(event, task_id),
            TaskStartedCtx {
                claude_session_id,
                real_cwd,
            },
        );
    }
}

fn handle_task_updated(session: &ClaudeSession, event: &Value, _sink: &dyn SessionSink) {
    let st = session.state.lock_recover();
    if !st.mainframe_chat_id.is_empty() {
        let chat_id = st.mainframe_chat_id.clone();
        let loc = crate::workflow_events::record_location(&st);
        st.task_events.handle_task_updated(
            &chat_id,
            crate::workflow_events::task_updated_payload(event),
            loc,
        );
    }
}

fn handle_task_notification(session: &ClaudeSession, event: &Value, _sink: &dyn SessionSink) {
    let mut st = session.state.lock_recover();
    let task_id = event
        .get("task_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    st.active_tasks.remove(&task_id);
    if !st.mainframe_chat_id.is_empty() {
        let chat_id = st.mainframe_chat_id.clone();
        let usage = event.get("usage").map(|u| TaskNotificationUsage {
            total_tokens: u.get("total_tokens").and_then(Value::as_i64).unwrap_or(0),
            tool_uses: u.get("tool_uses").and_then(Value::as_i64).unwrap_or(0),
            duration_ms: u.get("duration_ms").and_then(Value::as_i64).unwrap_or(0),
        });
        let loc = crate::workflow_events::record_location(&st);
        st.task_events.handle_task_notification(
            &chat_id,
            TaskNotificationPayload {
                task_id,
                status: event
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                output_file: event
                    .get("output_file")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                summary: event
                    .get("summary")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                usage,
            },
            loc,
        );
    }
}

fn task_started_payload(event: &Value, task_id: String) -> TaskStartedPayload {
    TaskStartedPayload {
        task_id,
        tool_use_id: event
            .get("tool_use_id")
            .and_then(Value::as_str)
            .map(str::to_string),
        description: event
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        task_type: event
            .get("task_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        workflow_name: event
            .get("workflow_name")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}
