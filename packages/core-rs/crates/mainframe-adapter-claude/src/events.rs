//! Ported from `packages/core/src/plugins/builtin/claude/events.ts`.
//!
//! NDJSON stdout dispatch (system / assistant / user / control_request /
//! control_response / result) + stderr filtering. `handle_stdout` buffers partial
//! chunks exactly like the TS (`buffer += chunk; split('\n'); buffer = pop()`) and
//! parses each complete line; non-JSON lines are skipped.

use serde_json::Value;

use mainframe_adapter_api::{AdapterError, SessionSink};
use mainframe_types::adapter::{
    ContextUsage, ControlRequest, ControlUpdate, MessageUsage, SessionResult,
};

use crate::assistant_event::handle_assistant_event;
use crate::quota_rate_limit::normalize_rate_limit_event;
use crate::session::ClaudeSession;
use crate::task_events::{
    TaskNotificationPayload, TaskNotificationUsage, TaskStartedCtx, TaskStartedPayload,
    TaskUpdatedPayload,
};
use crate::user_event::handle_user_event;

pub fn handle_stdout(session: &ClaudeSession, chunk: &[u8], sink: &dyn SessionSink) {
    let lines: Vec<String> = {
        let mut st = session.state.lock().unwrap_or_else(|e| e.into_inner());
        st.buffer.push_str(&String::from_utf8_lossy(chunk));
        let mut parts: Vec<String> = st.buffer.split('\n').map(str::to_string).collect();
        st.buffer = parts.pop().unwrap_or_default();
        parts
    };

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        session.bump_last_activity();
        tracing::trace!(session_id = %session.id, line = %line, "[stream-json]");
        if let Ok(event) = serde_json::from_str::<Value>(line.trim()) {
            handle_event(session, &event, sink);
        }
        // Not JSON — skip.
    }
}

/// `^Debugger`, `^Warning:`, `^DeprecationWarning`, `^ExperimentalWarning`,
/// `^(node:\d+)`, `^Cloning into` (the first four case-insensitive).
fn is_informational(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.starts_with("debugger")
        || lower.starts_with("warning:")
        || lower.starts_with("deprecationwarning")
        || lower.starts_with("experimentalwarning")
        || is_node_prefix(message)
        || message.starts_with("Cloning into")
}

/// `^\(node:\d+\)`
fn is_node_prefix(message: &str) -> bool {
    let Some(rest) = message.strip_prefix("(node:") else {
        return false;
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    !digits.is_empty() && rest[digits.len()..].starts_with(')')
}

fn is_trust_not_trusted(lower: &str) -> bool {
    lower.contains("has not been trusted")
}
fn is_trust_permissions(lower: &str) -> bool {
    lower.contains("permissions.allow") || lower.contains("hastrustdialogaccepted")
}

pub fn handle_stderr(session: &ClaudeSession, chunk: &[u8], sink: &dyn SessionSink) {
    let message = String::from_utf8_lossy(chunk).trim().to_string();
    if message.is_empty() {
        return;
    }
    if is_informational(&message) {
        return;
    }
    let lower = message.to_lowercase();
    if is_trust_not_trusted(&lower) && is_trust_permissions(&lower) {
        sink.on_trust_required(&session.project_path);
        return;
    }
    sink.on_error(AdapterError::Message(message));
}

fn handle_system_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let subtype = event.get("subtype").and_then(Value::as_str);
    match subtype {
        Some("init") => {
            let session_id = event
                .get("session_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            session
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .chat_id = session_id.clone();
            session.set_status(mainframe_types::adapter::AdapterProcessStatus::Ready);
            sink.on_init(&session_id);
        }
        Some("compact_boundary") => sink.on_compact(),
        Some("task_started") => {
            let mut st = session.state.lock().unwrap_or_else(|e| e.into_inner());
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
                    },
                    TaskStartedCtx {
                        claude_session_id,
                        real_cwd,
                    },
                );
            }
        }
        Some("task_updated") => {
            let st = session.state.lock().unwrap_or_else(|e| e.into_inner());
            if !st.mainframe_chat_id.is_empty() {
                let chat_id = st.mainframe_chat_id.clone();
                st.task_events.handle_task_updated(
                    &chat_id,
                    TaskUpdatedPayload {
                        task_id: event
                            .get("task_id")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        status: event
                            .get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    },
                );
            }
        }
        Some("task_notification") => {
            let mut st = session.state.lock().unwrap_or_else(|e| e.into_inner());
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
                );
            }
        }
        Some("status") if event.get("status").and_then(Value::as_str) == Some("compacting") => {
            sink.on_compact_start();
        }
        _ => {}
    }
}

fn handle_control_request_event(event: &Value, sink: &dyn SessionSink) {
    let request = event.get("request");
    let is_can_use = request
        .and_then(|r| r.get("subtype"))
        .and_then(Value::as_str)
        == Some("can_use_tool");
    if let Some(request) = request.filter(|_| is_can_use) {
        let input = request
            .get("input")
            .and_then(Value::as_object)
            .map(|m| m.clone().into_iter().collect())
            .unwrap_or_default();
        let suggestions: Vec<ControlUpdate> = request
            .get("permission_suggestions")
            .and_then(|s| serde_json::from_value(s.clone()).ok())
            .unwrap_or_default();
        let perm_request = ControlRequest {
            request_id: event
                .get("request_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            tool_name: request
                .get("tool_name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            tool_use_id: request
                .get("tool_use_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            input,
            suggestions,
            decision_reason: request
                .get("decision_reason")
                .and_then(Value::as_str)
                .map(str::to_string),
        };
        sink.on_permission(perm_request);
    } else {
        tracing::warn!(
            subtype = ?request.and_then(|r| r.get("subtype")),
            "Unhandled control_request subtype"
        );
    }
}

pub fn handle_control_response_event(
    session: &ClaudeSession,
    event: &Value,
    _sink: &dyn SessionSink,
) {
    let Some(response) = event.get("response") else {
        return;
    };
    let inner = response.get("response");
    if let Some(inner) = inner
        && inner.get("totalTokens").and_then(Value::as_i64).is_some()
        && inner.get("percentage").and_then(Value::as_f64).is_some()
    {
        let usage = ContextUsage {
            total_tokens: inner
                .get("totalTokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
            max_tokens: inner.get("maxTokens").and_then(Value::as_i64).unwrap_or(0),
            percentage: inner
                .get("percentage")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        };
        _sink.on_context_usage(usage);
    }

    // Route every other control_response through the session's correlation channel.
    if let Some(request_id) = response.get("request_id").and_then(Value::as_str) {
        session.control.resolve(request_id, Some(response.clone()));
    }
}

fn handle_rate_limit_event(event: &Value, sink: &dyn SessionSink) {
    let info = event.get("rate_limit_info");
    let now = chrono::Utc::now().timestamp_millis();
    if let Some(quota) = normalize_rate_limit_event(info, now) {
        sink.on_provider_quota("claude", quota);
    }
}

fn handle_result_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    // Surface CLI slash-command errors that reach us only via `result`.
    let result_text = event
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if !result_text.is_empty() {
        let lower = result_text.to_lowercase();
        if lower.starts_with("unknown command:") || lower.starts_with("unknown skill:") {
            sink.on_cli_message(result_text);
        }
    }

    let last_usage = {
        session
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .last_assistant_usage
            .take()
    };
    // Context size comes ONLY from the last parent assistant usage. The result
    // event's own `usage` is the QueryEngine total accumulated across every API
    // call in the turn (cache reads summed N times) — fine for cost accounting,
    // wrong as a context size (#197). `None` tells the sink "unknown this turn".
    let context_tokens: Option<i64> = last_usage.as_ref().map(|u| {
        u.input_tokens.unwrap_or(0)
            + u.cache_creation_input_tokens.unwrap_or(0)
            + u.cache_read_input_tokens.unwrap_or(0)
    });
    let usage: Option<MessageUsage> = last_usage.or_else(|| {
        event
            .get("usage")
            .and_then(|u| serde_json::from_value::<MessageUsage>(u.clone()).ok())
    });
    let tokens_input = usage
        .as_ref()
        .map(|u| {
            u.input_tokens.unwrap_or(0)
                + u.cache_creation_input_tokens.unwrap_or(0)
                + u.cache_read_input_tokens.unwrap_or(0)
        })
        .unwrap_or(0);
    let tokens_output = usage.as_ref().and_then(|u| u.output_tokens).unwrap_or(0);
    session.clear_interrupt_timer();

    tracing::debug!(
        session_id = %session.id,
        subtype = ?event.get("subtype"),
        "handling result event for parent session"
    );

    sink.on_result(SessionResult {
        total_cost_usd: Some(
            event
                .get("total_cost_usd")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ),
        usage: usage.as_ref().map(|u| MessageUsage {
            input_tokens: Some(tokens_input),
            output_tokens: Some(tokens_output),
            cache_creation_input_tokens: u.cache_creation_input_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens,
        }),
        context_tokens,
        subtype: event
            .get("subtype")
            .and_then(Value::as_str)
            .map(str::to_string),
        result: None,
        is_error: event.get("is_error").and_then(Value::as_bool),
    });

    // Refresh context usage after each result.
    session.request_context_usage();
}

fn handle_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    let ty = event.get("type").and_then(Value::as_str);
    tracing::debug!(
        session_id = %session.id,
        r#type = ?ty,
        subtype = ?event.get("subtype"),
        "claude event"
    );
    match ty {
        Some("system") => handle_system_event(session, event, sink),
        Some("assistant") => handle_assistant_event(session, event, sink),
        Some("user") => handle_user_event(session, event, sink),
        Some("control_request") => handle_control_request_event(event, sink),
        Some("control_response") => handle_control_response_event(session, event, sink),
        Some("rate_limit_event") => handle_rate_limit_event(event, sink),
        Some("result") => {
            // Subagent result events (parent_tool_use_id present) are inner
            // sub-turns — dropping them keeps the parent processState 'working'.
            if event
                .get("parent_tool_use_id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .is_some()
            {
                tracing::debug!(
                    session_id = %session.id,
                    "claude: skipping subagent result event (parent_tool_use_id present)"
                );
                return;
            }
            handle_result_event(session, event, sink);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::ClaudeSession;
    use mainframe_background_tasks::tracker::BackgroundTaskTracker;
    use mainframe_types::adapter::SessionOptions;
    use mainframe_types::adapter::{ContextUsage, ControlRequest, DetectedPr, MessageMetadata};
    use mainframe_types::chat::{MessageContent, TodoItem};
    use mainframe_types::context::SkillFileEntry;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Rec {
        init: Vec<String>,
        messages: usize,
        tool_results: usize,
        skill_files: Vec<SkillFileEntry>,
        skill_loaded: Vec<mainframe_adapter_api::LoadedSkill>,
        cli_messages: Vec<String>,
        subagent: Vec<(String, Vec<MessageContent>)>,
        todos: Vec<Vec<TodoItem>>,
        errors: usize,
        trust: Vec<String>,
        results: usize,
        compact: usize,
        compact_start: usize,
        context_usage: Vec<ContextUsage>,
        plan_files: Vec<String>,
        prs: Vec<DetectedPr>,
        queued: Vec<String>,
        permissions: Vec<ControlRequest>,
        provider_quota: Vec<(String, mainframe_types::adapter::ProviderQuota)>,
    }

    #[derive(Default)]
    struct RecordingSink {
        rec: Mutex<Rec>,
    }
    impl RecordingSink {
        fn r(&self) -> std::sync::MutexGuard<'_, Rec> {
            self.rec.lock().unwrap()
        }
    }
    impl SessionSink for RecordingSink {
        fn on_init(&self, session_id: &str) {
            self.r().init.push(session_id.to_string());
        }
        fn on_message(&self, _content: Vec<MessageContent>, _metadata: Option<MessageMetadata>) {
            self.r().messages += 1;
        }
        fn on_tool_result(&self, _content: Vec<MessageContent>) {
            self.r().tool_results += 1;
        }
        fn on_permission(&self, request: ControlRequest) {
            self.r().permissions.push(request);
        }
        fn on_result(&self, _data: SessionResult) {
            self.r().results += 1;
        }
        fn on_exit(&self, _code: Option<i32>) {}
        fn on_error(&self, _error: AdapterError) {
            self.r().errors += 1;
        }
        fn on_compact(&self) {
            self.r().compact += 1;
        }
        fn on_compact_start(&self) {
            self.r().compact_start += 1;
        }
        fn on_context_usage(&self, usage: ContextUsage) {
            self.r().context_usage.push(usage);
        }
        fn on_plan_file(&self, file_path: &str) {
            self.r().plan_files.push(file_path.to_string());
        }
        fn on_skill_file(&self, entry: SkillFileEntry) {
            self.r().skill_files.push(entry);
        }
        fn on_queued_processed(&self, uuid: &str) {
            self.r().queued.push(uuid.to_string());
        }
        fn on_todo_update(&self, todos: Vec<TodoItem>) {
            self.r().todos.push(todos);
        }
        fn on_pr_detected(&self, pr: DetectedPr) {
            self.r().prs.push(pr);
        }
        fn on_cli_message(&self, text: &str) {
            self.r().cli_messages.push(text.to_string());
        }
        fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
            self.r().skill_loaded.push(entry);
        }
        fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
            self.r()
                .subagent
                .push((parent_tool_use_id.to_string(), blocks));
        }
        fn on_trust_required(&self, project_path: &str) {
            self.r().trust.push(project_path.to_string());
        }
        fn on_provider_quota(&self, adapter_id: &str, quota: mainframe_types::adapter::ProviderQuota) {
            self.r().provider_quota.push((adapter_id.to_string(), quota));
        }
    }

    fn session_at(path: &str, tracker: Arc<BackgroundTaskTracker>) -> Arc<ClaudeSession> {
        let s = Arc::new(ClaudeSession::new(
            SessionOptions {
                project_path: path.to_string(),
                chat_id: None,
                mainframe_chat_id: "test-chat-id".to_string(),
            },
            None,
            tracker,
            mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        ));
        s.init_weak();
        s
    }
    fn session() -> Arc<ClaudeSession> {
        session_at("/tmp", Arc::new(BackgroundTaskTracker::new()))
    }
    fn feed(session: &ClaudeSession, sink: &RecordingSink, event: Value) {
        let line = format!("{}\n", serde_json::to_string(&event).unwrap());
        handle_stdout(session, line.as_bytes(), sink);
    }
    fn block_value(blocks: &[MessageContent], i: usize) -> Value {
        serde_json::to_value(&blocks[i]).unwrap()
    }

    // ---- handleStdout basics ----
    #[test]
    fn parses_complete_json_lines() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "system", "subtype": "init", "session_id": "s1" }),
        );
        assert_eq!(sink.r().init, vec!["s1".to_string()]);
    }

    #[test]
    fn handles_partial_chunks_by_buffering() {
        let s = session();
        let sink = RecordingSink::default();
        let event = serde_json::to_string(
            &serde_json::json!({ "type": "system", "subtype": "init", "session_id": "s1" }),
        )
        .unwrap();
        let (h1, h2) = event.split_at(20);
        handle_stdout(&s, h1.as_bytes(), &sink);
        assert!(sink.r().init.is_empty());
        handle_stdout(&s, format!("{h2}\n").as_bytes(), &sink);
        assert_eq!(sink.r().init, vec!["s1".to_string()]);
    }

    #[test]
    fn skips_non_json_and_empty_lines() {
        let s = session();
        let sink = RecordingSink::default();
        handle_stdout(&s, b"not json at all\n", &sink);
        handle_stdout(&s, b"\n\n\n", &sink);
        assert!(sink.r().init.is_empty());
        assert_eq!(sink.r().messages, 0);
    }

    // ---- skill detection ----
    #[test]
    fn detects_model_initiated_skill_and_resolves_path() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join(".claude/skills/brainstorming");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# brainstorming").unwrap();
        let s = session_at(
            tmp.path().to_str().unwrap(),
            Arc::new(BackgroundTaskTracker::new()),
        );
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "assistant",
                "message": { "model": "claude", "content": [
                    { "type": "tool_use", "id": "toolu_1", "name": "Skill", "input": { "skill": "brainstorming" } }
                ] }
            }),
        );
        let files = &sink.r().skill_files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, skill_dir.join("SKILL.md").to_string_lossy());
        assert_eq!(files[0].display_name, "brainstorming");
    }

    #[test]
    fn falls_back_to_home_skills_convention() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "assistant",
                "message": { "model": "claude", "content": [
                    { "type": "tool_use", "id": "toolu_2", "name": "Skill", "input": { "skill": "__definitely-not-installed" } }
                ] }
            }),
        );
        let expected = dirs::home_dir()
            .unwrap()
            .join(".claude/skills/__definitely-not-installed/SKILL.md")
            .to_string_lossy()
            .to_string();
        assert_eq!(sink.r().skill_files[0].path, expected);
    }

    #[test]
    fn skill_tool_use_without_name_does_not_fire_skill_file() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [
                    { "type": "tool_use", "id": "toolu_002", "name": "Skill", "input": {} }
                ] }
            }),
        );
        assert!(sink.r().skill_files.is_empty());
    }

    #[test]
    fn user_is_meta_text_skill_injection_fires_skill_file_and_loaded() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "user",
                "isMeta": true,
                "message": { "role": "user", "content": [
                    { "type": "text", "text": "<command-name>foo</command-name>\n<skill-format>true</skill-format>\n\nBase directory for this skill: /home/user/.claude/skills/foo\n\n# Foo skill body" }
                ] }
            }),
        );
        assert_eq!(
            sink.r().skill_files[0].path,
            "/home/user/.claude/skills/foo/SKILL.md"
        );
        assert_eq!(sink.r().skill_files[0].display_name, "foo");
        assert_eq!(sink.r().skill_loaded[0].skill_name, "foo");
        assert_eq!(
            sink.r().skill_loaded[0].path,
            "/home/user/.claude/skills/foo/SKILL.md"
        );
    }

    #[test]
    fn user_typed_skill_without_skill_format_tag() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "user",
                "isMeta": true,
                "message": { "role": "user", "content": [
                    { "type": "text", "text": "Base directory for this skill: /Users/me/.claude/plugins/cache/marketplace/work-logger/2.0.0/skills/slack-status-writer\n\n# Slack Status Writer\n\nBody." }
                ] }
            }),
        );
        assert_eq!(
            sink.r().skill_files[0].path,
            "/Users/me/.claude/plugins/cache/marketplace/work-logger/2.0.0/skills/slack-status-writer/SKILL.md"
        );
        assert_eq!(sink.r().skill_files[0].display_name, "slack-status-writer");
    }

    #[test]
    fn user_event_skill_format_strips_markers_from_content() {
        let s = session();
        let sink = RecordingSink::default();
        let text = "<command-name>brainstorming</command-name>\n<skill-format>true</skill-format>\nBase directory for this skill: /home/user/.claude/skills/brainstorming\n# brainstorming\n\nThink broadly.";
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "message": { "role": "user", "content": [ { "type": "text", "text": text } ] } }),
        );
        assert!(sink.r().cli_messages.is_empty());
        let loaded = &sink.r().skill_loaded[0];
        assert_eq!(loaded.skill_name, "brainstorming");
        assert_eq!(
            loaded.path,
            "/home/user/.claude/skills/brainstorming/SKILL.md"
        );
        assert!(loaded.content.contains("# brainstorming"));
        assert!(!loaded.content.contains("<command-name>"));
        assert!(!loaded.content.contains("<skill-format>"));
        assert!(!loaded.content.contains("Base directory for this skill:"));
    }

    #[test]
    fn non_skill_cli_text_still_fires_cli_message() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "message": { "role": "user", "content": [ { "type": "text", "text": "Unknown command: /typo. Did you mean /brainstorming?" } ] } }),
        );
        assert_eq!(
            sink.r().cli_messages,
            vec!["Unknown command: /typo. Did you mean /brainstorming?".to_string()]
        );
        assert!(sink.r().skill_loaded.is_empty());
    }

    // ---- CLI-feedback text ----
    #[test]
    fn surfaces_cli_text_when_not_replay_not_meta() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "message": { "role": "user", "content": [ { "type": "text", "text": "Unknown command: /inisights. Did you mean /insights?" } ] } }),
        );
        assert_eq!(
            sink.r().cli_messages,
            vec!["Unknown command: /inisights. Did you mean /insights?".to_string()]
        );
    }

    #[test]
    fn skips_cli_message_when_replay() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "isReplay": true, "uuid": "some-uuid", "message": { "role": "user", "content": [ { "type": "text", "text": "Hello from user" } ] } }),
        );
        assert!(sink.r().cli_messages.is_empty());
        assert_eq!(sink.r().queued, vec!["some-uuid".to_string()]);
    }

    #[test]
    fn skips_cli_message_when_meta_local_command() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "isMeta": true, "message": { "role": "user", "content": [ { "type": "text", "text": "<local-command-caveat>skill content</local-command-caveat>" } ] } }),
        );
        assert!(sink.r().cli_messages.is_empty());
    }

    // ---- subagent routing ----
    #[test]
    fn routes_subagent_assistant_events_to_subagent_child_with_tagged_blocks() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "assistant",
                "parent_tool_use_id": "toolu_parent_agent",
                "message": { "role": "assistant", "model": "claude-opus-4-7", "content": [
                    { "type": "thinking", "thinking": "subagent inner thought" },
                    { "type": "text", "text": "Let me run a command." },
                    { "type": "tool_use", "id": "toolu_subagent_bash", "name": "Bash", "input": { "command": "ls" } }
                ] }
            }),
        );
        assert_eq!(sink.r().messages, 0);
        let rec = sink.r();
        assert_eq!(rec.subagent.len(), 1);
        let (parent, blocks) = &rec.subagent[0];
        assert_eq!(parent, "toolu_parent_agent");
        assert_eq!(blocks.len(), 3);
        for i in 0..3 {
            assert_eq!(
                block_value(blocks, i)["parentToolUseId"],
                "toolu_parent_agent"
            );
        }
    }

    #[test]
    fn routes_dispatch_prompt_text_block_to_subagent_child() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "user",
                "parent_tool_use_id": "toolu_parent_agent",
                "message": { "role": "user", "content": [ { "type": "text", "text": "Run `echo hi` via Bash and report the output." } ] }
            }),
        );
        assert!(sink.r().cli_messages.is_empty());
        let rec = sink.r();
        let (parent, blocks) = &rec.subagent[0];
        assert_eq!(parent, "toolu_parent_agent");
        assert_eq!(
            block_value(blocks, 0),
            serde_json::json!({ "type": "text", "text": "Run `echo hi` via Bash and report the output.", "parentToolUseId": "toolu_parent_agent" })
        );
    }

    #[test]
    fn routes_raw_string_content_to_subagent_child() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "parent_tool_use_id": "toolu_parent_agent", "message": { "role": "user", "content": "raw string body" } }),
        );
        let rec = sink.r();
        let (parent, blocks) = &rec.subagent[0];
        assert_eq!(parent, "toolu_parent_agent");
        assert_eq!(
            block_value(blocks, 0),
            serde_json::json!({ "type": "text", "text": "raw string body", "parentToolUseId": "toolu_parent_agent" })
        );
    }

    #[test]
    fn routes_subagent_tool_result_via_subagent_child_not_tool_result() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({
                "type": "user",
                "parent_tool_use_id": "toolu_parent_agent",
                "message": { "role": "user", "content": [ { "type": "tool_result", "tool_use_id": "toolu_subagent_bash", "content": "hi" } ] }
            }),
        );
        assert_eq!(sink.r().tool_results, 0);
        let rec = sink.r();
        let (parent, blocks) = &rec.subagent[0];
        assert_eq!(parent, "toolu_parent_agent");
        assert_eq!(block_value(blocks, 0)["type"], "tool_result");
        assert_eq!(
            block_value(blocks, 0)["parentToolUseId"],
            "toolu_parent_agent"
        );
    }

    #[test]
    fn routes_subagent_skill_load_string_command_name() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join(".claude/skills/pencil");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Pencil\nbody").unwrap();
        let s = session_at(
            tmp.path().to_str().unwrap(),
            Arc::new(BackgroundTaskTracker::new()),
        );
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "parent_tool_use_id": "toolu_parent_agent", "message": { "role": "user", "content": "<command-name>pencil</command-name>" } }),
        );
        assert!(sink.r().skill_loaded.is_empty());
        let rec = sink.r();
        let (parent, blocks) = &rec.subagent[0];
        assert_eq!(parent, "toolu_parent_agent");
        assert_eq!(block_value(blocks, 0)["type"], "skill_loaded");
        assert_eq!(block_value(blocks, 0)["skillName"], "pencil");
        assert_eq!(
            block_value(blocks, 0)["parentToolUseId"],
            "toolu_parent_agent"
        );
    }

    #[test]
    fn extracts_skill_loaded_from_subagent_array_content() {
        let s = session();
        let sink = RecordingSink::default();
        let text = "<command-name>brainstorming</command-name>\n<skill-format>true</skill-format>\nBase directory for this skill: /home/user/.claude/skills/brainstorming\n# Brainstorming\n\nThink broadly.";
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "parent_tool_use_id": "toolu_parent_agent", "message": { "role": "user", "content": [ { "type": "text", "text": text } ] } }),
        );
        let rec = sink.r();
        let (parent, blocks) = &rec.subagent[0];
        assert_eq!(parent, "toolu_parent_agent");
        assert_eq!(blocks.len(), 1);
        let v = block_value(blocks, 0);
        assert_eq!(v["type"], "skill_loaded");
        assert_eq!(v["skillName"], "brainstorming");
        assert_eq!(
            v["path"],
            "/home/user/.claude/skills/brainstorming/SKILL.md"
        );
        assert_eq!(v["parentToolUseId"], "toolu_parent_agent");
        assert!(!v["content"].as_str().unwrap().contains("<skill-format>"));
    }

    #[test]
    fn parent_level_null_parent_takes_existing_path() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "parent_tool_use_id": Value::Null, "message": { "role": "user", "content": [ { "type": "text", "text": "Unknown command: /typo" } ] } }),
        );
        assert_eq!(
            sink.r().cli_messages,
            vec!["Unknown command: /typo".to_string()]
        );
        assert!(sink.r().subagent.is_empty());
    }

    // ---- compaction summary suppression (#150) ----
    #[test]
    fn skips_string_content_flagged_is_compact_summary() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "isCompactSummary": true, "isVisibleInTranscriptOnly": true, "message": { "role": "user", "content": "This session is being continued from a previous conversation that ran out of context. Summary: ..." } }),
        );
        assert!(sink.r().cli_messages.is_empty());
    }

    #[test]
    fn surfaces_visible_in_transcript_only() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "isVisibleInTranscriptOnly": true, "message": { "role": "user", "content": "Unknown skill: /unknown" } }),
        );
        assert_eq!(
            sink.r().cli_messages,
            vec!["Unknown skill: /unknown".to_string()]
        );
    }

    #[test]
    fn skips_when_content_begins_with_compaction_preamble() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "user", "message": { "role": "user", "content": "This session is being continued from a previous conversation that ran out of context. Summary: ..." } }),
        );
        assert!(sink.r().cli_messages.is_empty());
    }

    // ---- handleStderr ----
    #[test]
    fn stderr_emits_error_for_non_informational() {
        let s = session();
        let sink = RecordingSink::default();
        handle_stderr(&s, b"Something went wrong\n", &sink);
        assert_eq!(sink.r().errors, 1);
    }

    #[test]
    fn stderr_filters_informational_and_empty() {
        let s = session();
        let sink = RecordingSink::default();
        handle_stderr(&s, b"Warning: some deprecation\n", &sink);
        handle_stderr(&s, b"   \n", &sink);
        assert_eq!(sink.r().errors, 0);
    }

    #[test]
    fn stderr_routes_untrusted_advisory_to_trust_required() {
        let s = session_at("/home/me/proj", Arc::new(BackgroundTaskTracker::new()));
        let sink = RecordingSink::default();
        handle_stderr(
            &s,
            b"Ignoring 4 permissions.allow entries from .claude/settings.local.json: this workspace has not been trusted. Run Claude Code interactively here once...",
            &sink,
        );
        assert_eq!(sink.r().trust, vec!["/home/me/proj".to_string()]);
        assert_eq!(sink.r().errors, 0);
    }

    #[test]
    fn stderr_routes_fatal_with_not_trusted_to_error() {
        let s = session_at("/p", Arc::new(BackgroundTaskTracker::new()));
        let sink = RecordingSink::default();
        handle_stderr(
            &s,
            b"FatalError: this workspace has not been trusted and the process crashed unexpectedly",
            &sink,
        );
        assert_eq!(sink.r().errors, 1);
        assert!(sink.r().trust.is_empty());
    }

    // ---- subagent result isolation (#141) ----
    #[test]
    fn subagent_result_does_not_fire_on_result() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "result", "subtype": "success", "total_cost_usd": 0.001, "parent_tool_use_id": "toolu_task_1", "usage": { "input_tokens": 100, "output_tokens": 50 } }),
        );
        assert_eq!(sink.r().results, 0);
    }

    #[test]
    fn top_level_result_fires_on_result() {
        let s = session();
        let sink = RecordingSink::default();
        feed(
            &s,
            &sink,
            serde_json::json!({ "type": "result", "subtype": "success", "total_cost_usd": 0.002, "usage": { "input_tokens": 200, "output_tokens": 80 } }),
        );
        assert_eq!(sink.r().results, 1);
    }

    // ---- todo-extraction ----
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

    // ---- task-events-integration (mainframe chat id) ----
    #[test]
    fn task_started_lands_in_tracker_under_mainframe_chat_id() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let s = Arc::new(ClaudeSession::new(
            SessionOptions {
                project_path: "/tmp".to_string(),
                chat_id: None,
                mainframe_chat_id: "mf-chat-42".to_string(),
            },
            None,
            tracker.clone(),
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
    fn task_notification_reflects_completion_under_mainframe_chat_id() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let s = Arc::new(ClaudeSession::new(
            SessionOptions {
                project_path: "/tmp".to_string(),
                chat_id: None,
                mainframe_chat_id: "mf-chat-99".to_string(),
            },
            None,
            tracker.clone(),
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
    fn task_started_threads_task_type_through_to_the_tracked_kind() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let s = Arc::new(ClaudeSession::new(
            SessionOptions {
                project_path: "/tmp".to_string(),
                chat_id: None,
                mainframe_chat_id: "mf-chat-7".to_string(),
            },
            None,
            tracker.clone(),
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
    fn task_updated_with_a_terminal_status_ends_the_task() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let s = Arc::new(ClaudeSession::new(
            SessionOptions {
                project_path: "/tmp".to_string(),
                chat_id: None,
                mainframe_chat_id: "mf-chat-8".to_string(),
            },
            None,
            tracker.clone(),
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
            serde_json::json!({ "type": "system", "subtype": "task_updated", "task_id": "task-u", "status": "failed" }),
        );
        assert_eq!(
            tracker.get("mf-chat-8", "task-u").unwrap().status,
            mainframe_types::background_task::BackgroundTaskStatus::Failed
        );
    }

    // ---- rate_limit_event wiring (#255/#258) ----
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
        assert_eq!(session.kind, mainframe_types::adapter::QuotaWindowKind::Session);
        assert_eq!(session.used_percent, 42.0);
        assert_eq!(session.resets_at, Some(1_789_999_999_000));
        assert_eq!(session.label, None);
        // observedAt (#268) is stamped from the wall clock at handling time.
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

    // ---- stop-task-routing (control_response forwarding) ----
    #[tokio::test]
    async fn control_response_resolves_a_real_pending_stop_task_awaiter() {
        let s = session();
        let sink = RecordingSink::default();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let control = s.control.clone();
        let pending = tokio::spawn(async move {
            control
                .send_awaiting(
                    Some(&tx),
                    &serde_json::json!({ "subtype": "stop_task", "task_id": "t1" }),
                    crate::session_control::SendAwaitingOpts {
                        label: "stop_task".to_string(),
                        timeout_ms: Some(1000),
                        is_terminal: Some(Box::new(|r: &Option<Value>| {
                            r.as_ref()
                                .and_then(|v| v.get("subtype"))
                                .and_then(Value::as_str)
                                == Some("error")
                                || r.as_ref()
                                    .and_then(|v| v.get("subtype"))
                                    .and_then(Value::as_str)
                                    == Some("success")
                        })),
                    },
                )
                .await
        });
        let request_id = loop {
            tokio::task::yield_now().await;
            if let Ok(bytes) = rx.try_recv() {
                break serde_json::from_slice::<Value>(&bytes).unwrap()["request_id"]
                    .as_str()
                    .unwrap()
                    .to_string();
            }
        };
        handle_control_response_event(
            &s,
            &serde_json::json!({ "type": "control_response", "response": { "request_id": request_id, "subtype": "error", "error": "no such task" } }),
            &sink,
        );
        let raw = pending.await.unwrap().unwrap();
        assert_eq!(raw["subtype"], "error");
        assert_eq!(raw["error"], "no such task");
    }

    #[test]
    fn control_response_unknown_request_id_does_not_panic() {
        let s = session();
        let sink = RecordingSink::default();
        handle_control_response_event(
            &s,
            &serde_json::json!({ "type": "control_response", "response": { "request_id": "unknown", "subtype": "success" } }),
            &sink,
        );
    }
}

// PORT STATUS: src/plugins/builtin/claude/events.ts (227 lines)
// confidence: high
// todos: 0
// notes: handle_stdout buffers via split('\n')+pop like TS; unknown event types
// notes: fall through the match (logged once at the top debug!, as TS logs every
// notes: event) — no hard error. Informational stderr patterns + the two-token
// notes: trust advisory are hand-rolled (no regex crate). Tests ported from
// notes: claude-events.test.ts (handleStdout/handleStderr, subagent, compaction,
// notes: result isolation), todo-extraction, task-events-integration (real
// notes: tracker keyed by mainframeChatId), and stop-task-routing (the resolve()
// notes: spy assertion is exercised via a real pending awaiter — same fact).
// notes: rate_limit_event (#255/#258) normalizes via quota_rate_limit and emits
// notes: through sink.on_provider_quota; chrono::Utc::now() is read only at this
// notes: wiring boundary, mirroring the TS Date.now() call at the same layer.
