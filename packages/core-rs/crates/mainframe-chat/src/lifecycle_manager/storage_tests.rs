use super::*;

#[test]
fn failed_context_loss_write_still_clears_resume_and_emits_update() {
    let mut chat = crate::test_support::test_chat("c1");
    chat.vendor_session_ephemeral = true;
    chat.vendor_session_id = Some("expired".into());
    let deps = tests::fake(chat.clone(), Vec::new());
    *deps.store.write_failure.lock_recover() = Some("write failed".into());
    let manager = tests::manager(deps.clone());
    let cell = Arc::new(Mutex::new(ActiveChat::new(chat.clone(), None)));
    manager
        .shared
        .active_chats
        .insert(chat.id.clone(), cell.clone());
    manager.mark_context_lost_if_needed("c1", &mut chat);
    assert!(chat.vendor_session_id.is_none());
    assert!(chat.context_lost_at.is_some());
    assert!(cell.lock_recover().chat.vendor_session_id.is_none());
    assert!(deps.events().iter().any(|event| matches!(event,
        DaemonEvent::ChatUpdated { chat, .. } if chat.id == "c1" && chat.context_lost_at.is_some())));
}
