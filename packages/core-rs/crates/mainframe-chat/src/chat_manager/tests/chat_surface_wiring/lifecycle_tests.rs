//! Permission-resolution and chat-teardown cases for the chat-surface seam
//! (task 14, todo #350) — split out of `chat_surface_wiring.rs` (plan task
//! 37, R2.13) to keep that file under the 300-line cap.

use super::*;

fn allow_response(request_id: &str, tool_use_id: &str) -> ControlResponse {
    ControlResponse {
        request_id: request_id.to_string(),
        tool_use_id: tool_use_id.to_string(),
        tool_name: Some("Bash".to_string()),
        behavior: ControlBehavior::Allow,
        updated_input: None,
        updated_permissions: None,
        message: None,
        execution_mode: None,
        clear_context: None,
        scope: None,
    }
}

fn control_request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: format!("{request_id}-tool"),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    }
}

/// Plan task 17: the facade's cross-surface gate resolution relies on the
/// chat surface hearing about a permission answered *normally* (not just a
/// CLI-cancelled one, which `on_permission_cancelled` already covered above)
/// — a legacy-surface answer is the only way a facade session's pending gate
/// ever resolves, since `respond_to_permission` is the single entry point
/// both surfaces call.
#[tokio::test]
async fn answering_a_permission_normally_emits_gate_resolved_on_the_chat_surface() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );
    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_permission(control_request("req_1"));

    mgr.respond_to_permission("c1", allow_response("req_1", "req_1-tool"))
        .await
        .unwrap();

    assert!(
        surface.events().iter().any(|e| matches!(
            e,
            ChatSurfaceEvent::GateResolved { request_id, .. } if request_id == "req_1"
        )),
        "a legacy-surface answer must reach the chat surface, or a facade \
         gate registry can never learn the request resolved elsewhere"
    );
}

/// The other half of task 17's promotion path: answering the front of a
/// multi-request queue must raise the newly-promoted request on the chat
/// surface too, not just via the legacy `DaemonEvent`.
#[tokio::test]
async fn answering_the_front_request_raises_the_promoted_one_on_the_chat_surface() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );
    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_permission(control_request("req_1"));
    sink.on_permission(control_request("req_2"));

    mgr.respond_to_permission("c1", allow_response("req_1", "req_1-tool"))
        .await
        .unwrap();

    assert!(
        surface.events().iter().any(|e| matches!(
            e,
            ChatSurfaceEvent::GateRaised { request, .. } if request.request_id == "req_2"
        )),
        "the promoted request must be raised on the chat surface for a facade to redeliver it"
    );
}

/// Teardown reaches the chat surface: the facade hub's `GateRegistry` and
/// per-connection session state are cleared only by `ChatEnded` — without
/// this emission `GateRegistry::forget_chat` has no production caller.
#[tokio::test]
async fn ending_a_chat_emits_chat_ended_on_the_chat_surface() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );

    mgr.end_chat("c1").await;

    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::ChatEnded { chat_id } if chat_id == "c1")),
        "end_chat must announce teardown on the chat surface"
    );
}

#[tokio::test]
async fn removing_a_project_emits_chat_ended_for_each_of_its_chats() {
    let mut c1 = test_chat("c1");
    c1.project_id = "p1".to_string();
    let mut c2 = test_chat("c2");
    c2.project_id = "p1".to_string();
    let deps = StoreDeps::with_chats(vec![c1, c2]);
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());

    mgr.remove_project("p1").await.unwrap();

    let mut ended: Vec<String> = surface
        .events()
        .iter()
        .filter_map(|e| match e {
            ChatSurfaceEvent::ChatEnded { chat_id } => Some(chat_id.clone()),
            _ => None,
        })
        .collect();
    ended.sort(); // chats_list order is storage-defined, not part of the contract
    assert_eq!(
        ended,
        vec!["c1".to_string(), "c2".to_string()],
        "project removal must announce teardown for every chat it tears down"
    );
}

#[tokio::test]
async fn archiving_a_chat_emits_chat_ended_on_the_chat_surface() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );

    mgr.archive_chat("c1", false).await;

    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::ChatEnded { chat_id } if chat_id == "c1")),
        "archive_chat must announce teardown on the chat surface"
    );
}
