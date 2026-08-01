//! Unit tests (T6) for `ChatPlanActionCtx` against a fake `PlanHost` plus a real
//! `PermissionManager`/`MessageCache` and the crate's recording `StoreDeps`
//! (`chat_manager::tests`, exposed `pub(crate)` for reuse here rather than
//! duplicating a second `ChatManagerDeps` fake). The `PlanHostImpl`-specific
//! "no ChatManager attached" case lives beside it in `chat_manager/tests/`
//! instead — this module intentionally never names `EhDeps`/`LcDeps`, and a real
//! `PlanHostImpl` needs both.

use super::*;
use crate::chat_manager::tests::StoreDeps;
use crate::test_support::test_chat;
use mainframe_runtime::time::now_iso8601;
use mainframe_types::adapter::ControlRequest;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;
use std::collections::HashMap;

#[derive(Default)]
struct FakeHost {
    events: Mutex<Vec<DaemonEvent>>,
}

impl PlanHost for FakeHost {
    fn emit_event(&self, event: DaemonEvent) {
        self.events.lock().unwrap().push(event);
    }
    fn clear_display_cache(&self, _chat_id: &str) {}
    fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn send_message<'a>(
        &'a self,
        _chat_id: &'a str,
        _content: &'a str,
    ) -> BoxFuture<'a, Result<(), AdapterError>> {
        Box::pin(async { Ok(()) })
    }
}

fn ctx_with(
    chat_id: &str,
    request_id: &str,
    chat: mainframe_types::chat::Chat,
) -> ChatPlanActionCtx {
    let active_chats: PlanRegistry = Arc::new(DashMap::new());
    let deps = StoreDeps::with_chats(vec![chat.clone()]);
    active_chats.insert(
        chat_id.to_string(),
        Arc::new(Mutex::new(ActiveChat {
            chat,
            session: None,
            turn_started_at: None,
        })),
    );
    ChatPlanActionCtx {
        chat_id: chat_id.to_string(),
        request_id: request_id.to_string(),
        deps,
        active_chats,
        messages: Arc::new(Mutex::new(MessageCache::new())),
        permissions: Arc::new(Mutex::new(PermissionManager::new())),
        host: Arc::new(FakeHost::default()),
    }
}

fn request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "ExitPlanMode".to_string(),
        tool_use_id: "t1".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

fn text_message(text: &str) -> ChatMessage {
    ChatMessage {
        id: "m1".to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: now_iso8601(),
        metadata: None,
    }
}

#[test]
fn permissions_shift_pops_only_the_matching_front_request() {
    let ctx = ctx_with("c1", "r2", test_chat("c1"));
    ctx.permissions.lock().unwrap().enqueue("c1", request("r1"));
    ctx.permissions.lock().unwrap().enqueue("c1", request("r2"));

    ctx.permissions_shift();
    assert_eq!(
        ctx.permissions
            .lock()
            .unwrap()
            .get_pending("c1")
            .unwrap()
            .request_id,
        "r1"
    );

    let ctx = ctx_with("c1", "r1", test_chat("c1"));
    ctx.permissions.lock().unwrap().enqueue("c1", request("r1"));
    ctx.permissions.lock().unwrap().enqueue("c1", request("r2"));

    ctx.permissions_shift();
    assert_eq!(
        ctx.permissions
            .lock()
            .unwrap()
            .get_pending("c1")
            .unwrap()
            .request_id,
        "r2"
    );
}

#[test]
fn update_chat_with_clear_claude_session_id_calls_chats_clear_session_and_nulls_the_in_memory_id() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let ctx = ctx_with("c1", "r1", chat);

    ctx.update_chat(PlanChatUpdate {
        plan_mode: Some(false),
        permission_mode: None,
        clear_claude_session_id: true,
    });

    assert_eq!(ctx.deps.chats_get("c1").unwrap().claude_session_id, None);
    assert_eq!(
        ctx.active().unwrap().lock().unwrap().chat.claude_session_id,
        None
    );
}

#[test]
fn update_chat_without_it_never_calls_chats_clear_session() {
    let mut chat = test_chat("c1");
    chat.claude_session_id = Some("sess-1".to_string());
    let ctx = ctx_with("c1", "r1", chat);

    ctx.update_chat(PlanChatUpdate {
        plan_mode: Some(false),
        permission_mode: None,
        clear_claude_session_id: false,
    });

    assert_eq!(
        ctx.deps.chats_get("c1").unwrap().claude_session_id,
        Some("sess-1".to_string())
    );
    assert_eq!(
        ctx.active().unwrap().lock().unwrap().chat.claude_session_id,
        Some("sess-1".to_string())
    );
}

#[test]
fn recover_latest_plan_file_reads_the_cached_messages() {
    let ctx = ctx_with("c1", "r1", test_chat("c1"));
    assert_eq!(ctx.recover_latest_plan_file(), None);

    ctx.messages.lock().unwrap().set(
        "c1",
        vec![
            text_message("Your plan has been saved to: /tmp/old.md"),
            text_message("Your plan has been saved to: /tmp/new.md"),
        ],
    );
    assert_eq!(
        ctx.recover_latest_plan_file(),
        Some("/tmp/new.md".to_string())
    );
}

#[test]
fn clear_messages_empties_the_cache_for_that_chat_only() {
    let ctx = ctx_with("c1", "r1", test_chat("c1"));
    let untouched = vec![text_message("bye")];
    ctx.messages
        .lock()
        .unwrap()
        .set("c1", vec![text_message("hi")]);
    ctx.messages.lock().unwrap().set("c2", untouched.clone());

    ctx.clear_messages();

    assert_eq!(ctx.messages.lock().unwrap().get("c1"), Some(&Vec::new()));
    assert_eq!(ctx.messages.lock().unwrap().get("c2"), Some(&untouched));
}
