use std::collections::HashMap as StdHashMap;
use std::sync::Mutex as StdMutex;

use mainframe_adapter_api::{AdapterError, ContextFiles, ImageInput, SessionSink};
use mainframe_background_tasks::tracker::{BackgroundTaskTracker, TaskSeed};
use mainframe_claude_workflows::store::ProgressUsage;
use mainframe_db::DatabaseManager;
use mainframe_types::adapter::{
    AdapterProcess, ControlResponse, DetectedPrSource, SessionSpawnOptions,
};
use mainframe_types::background_task::{BackgroundTaskToolName, BackgroundWorkKind};
use mainframe_types::chat::MessageContentNode;
use mainframe_types::claude_workflow::ClaudeWorkflowRunStatus;
use mainframe_types::context::MentionKind;
use mainframe_types::settings_kv::MemorySettings;

use super::*;
use crate::chat_seams::{NoopLaunchStopper, NoopScopeTunnelStopper};

use mainframe_runtime::log_capture::LogCapture;

fn text_msg(id: &str, r#type: ChatMessageType, text: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-01-01T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

fn tool_use_msg(id: &str, tool_use_id: &str, name: &str, command: &str) -> ChatMessage {
    let mut input = StdHashMap::new();
    input.insert(
        "command".to_string(),
        serde_json::Value::String(command.to_string()),
    );
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Node(MessageContentNode::ToolUse {
            timing: None,
            command_execution: None,
            id: tool_use_id.to_string(),
            name: name.to_string(),
            input,
            parent_tool_use_id: None,
        })],
        timestamp: "2026-01-01T00:00:01.000Z".to_string(),
        metadata: None,
    }
}

fn tool_result_msg(id: &str, tool_use_id: &str, content: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::ToolResult,
        content: vec![MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: content.to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            images: Vec::new(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-01-01T00:00:02.000Z".to_string(),
        metadata: None,
    }
}

// -- scan_history_for_prs (moved to mainframe-adapter-api::pr_detection::history;
//    tests live in that crate's tests/pr_detection_history.rs) --

// -- scan_history_for_mentions ----------------------------------------

#[derive(Default)]
struct RecordingCtxDb {
    added: StdMutex<Vec<SessionMention>>,
}

impl ContextDb for RecordingCtxDb {
    fn add_mention(&self, _chat_id: &str, mention: &SessionMention) -> Result<bool, SeamError> {
        self.added.lock().unwrap().push(mention.clone());
        Ok(true)
    }
    fn get_mentions(&self, _chat_id: &str) -> Result<Vec<SessionMention>, SeamError> {
        Ok(Vec::new())
    }
    fn get_plan_files(&self, _chat_id: &str) -> Result<Vec<String>, SeamError> {
        Ok(Vec::new())
    }
    fn get_skill_files(&self, _chat_id: &str) -> Result<Vec<SkillFileEntry>, SeamError> {
        Ok(Vec::new())
    }
}

#[test]
fn scan_history_for_mentions_extracts_at_reference_from_user_text() {
    let history = vec![text_msg(
        "m1",
        ChatMessageType::User,
        "please review @src/foo.ts",
    )];
    let ctx_db = RecordingCtxDb::default();
    scan_history_for_mentions("c1", &history, &ctx_db).unwrap();
    let added = ctx_db.added.lock().unwrap();
    assert_eq!(added.len(), 1);
    assert_eq!(added[0].kind, MentionKind::File);
    assert_eq!(added[0].name, "foo.ts");
    assert_eq!(added[0].path.as_deref(), Some("src/foo.ts"));
}

#[test]
fn scan_history_for_mentions_skips_mainframe_command_injection_blocks() {
    let history = vec![text_msg(
        "m1",
        ChatMessageType::User,
        "<mainframe-command>@src/foo.ts</mainframe-command>",
    )];
    let ctx_db = RecordingCtxDb::default();
    scan_history_for_mentions("c1", &history, &ctx_db).unwrap();
    assert!(ctx_db.added.lock().unwrap().is_empty());
}

#[test]
fn scan_history_for_mentions_ignores_non_user_messages() {
    let history = vec![text_msg("m1", ChatMessageType::Assistant, "@src/foo.ts")];
    let ctx_db = RecordingCtxDb::default();
    scan_history_for_mentions("c1", &history, &ctx_db).unwrap();
    assert!(ctx_db.added.lock().unwrap().is_empty());
}

// -- full DaemonChatDeps harness (scan_and_persist_prs / plan+skill files) --

fn test_deps() -> DaemonChatDeps {
    let db = Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap();
    // `emit_event` ignores the "no subscribers" send error, so the
    // constructor's own receiver can be dropped immediately.
    let (broadcast, _rx) = broadcast::channel::<DaemonEvent>(16);
    let quota = QuotaManager::new(mainframe_services::quota::QuotaManagerDeps {
        settings: Arc::new(MemorySettings::default()),
        emit_event: Box::new(|_| {}),
        now: None,
    });
    DaemonChatDeps {
        notification_config: Default::default(),
        db,
        adapters: Arc::new(AdapterRegistry::new()),
        background_tasks: Arc::new(BackgroundTaskTracker::new()),
        attachments: Arc::new(AttachmentStore::new(
            std::env::temp_dir().join("mf-chat-deps-test"),
        )),
        push: Arc::new(PushService::new()),
        git: GitFactory,
        broadcast,
        launch: Arc::new(NoopLaunchStopper),
        scope_tunnels: Arc::new(NoopScopeTunnelStopper),
        quota: Arc::new(quota),
        claude_workflows: Arc::new(ClaudeWorkflowStore::new()),
        data_dir: std::env::temp_dir().join("mf-chat-deps-test-data"),
    }
}

#[tokio::test]
async fn unknown_adapter_id_logs_and_returns_none() {
    let deps = test_deps();
    let (subscriber, events) = LogCapture::install();
    let _guard = tracing::subscriber::set_default(subscriber);

    let result = AdapterPort::generate_title(&deps, "not-a-real-adapter", "hello", "claude").await;

    assert_eq!(result, None);
    assert_eq!(
        LogCapture::events_with_reason(&events),
        vec![(tracing::Level::WARN, "unknown_adapter".to_string())]
    );
}

#[test]
fn initial_transcript_path_routes_to_the_owning_adapter() {
    let deps = test_deps();
    deps.adapters.register(Arc::new(
        mainframe_adapter_claude::adapter::ClaudeAdapter::default(),
    ));
    deps.adapters
        .register(Arc::new(mainframe_adapter_codex::CodexAdapter::default()));
    let claude_path = dirs::home_dir()
        .unwrap()
        .join(".claude/projects/-proj/session-1.jsonl")
        .to_string_lossy()
        .into_owned();

    assert_eq!(
        AdapterPort::initial_transcript_path(&deps, "claude", "session-1", "/proj"),
        Some(claude_path)
    );
    assert_eq!(
        AdapterPort::initial_transcript_path(&deps, "codex", "session-1", "/proj"),
        None
    );
    assert_eq!(
        AdapterPort::initial_transcript_path(&deps, "unknown", "session-1", "/proj"),
        None
    );
}

/// Production must actually ship the incremental projector, not just build
/// one in a test harness (the scaling gates in `mainframe-adapter-claude`
/// and this crate both construct
/// `IncrementalProjector` directly and so cannot catch a
/// `display_projector()` that silently falls back to a full rebuild).
/// A second `project` call over an appended message must come back
/// `full: false`.
#[test]
fn display_projector_emits_non_full_deltas_on_a_partial() {
    use mainframe_display::{ProjectionInput, RawChange, RawChanges};

    let deps = test_deps();
    let mut projector = deps.display_projector();

    let m1 = text_msg("m1", ChatMessageType::User, "hello");
    let seed = projector.project(ProjectionInput {
        raw: std::slice::from_ref(&m1),
        changes: RawChanges::new(),
        overlay: None,
        categories: None,
    });
    assert!(
        seed.full,
        "the first call has no prior state, so it is a full rebuild"
    );

    let m2 = text_msg("m2", ChatMessageType::Assistant, "hi there");
    let mut changes = RawChanges::new();
    changes.push(RawChange::Appended);
    let partial = projector.project(ProjectionInput {
        raw: &[m1, m2],
        changes,
        overlay: None,
        categories: None,
    });
    assert!(
        !partial.full,
        "display_projector() must emit incremental deltas on a partial, not fall back to a full rebuild"
    );
}
