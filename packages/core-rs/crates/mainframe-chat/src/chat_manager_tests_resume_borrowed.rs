use super::*;

#[tokio::test]
async fn a_warm_resume_reader_borrows_the_projection_and_copies_only_its_selected_range() {
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("sess-1".into());
    let mut deps = FakeDeps::with_chats(vec![chat]);
    Arc::get_mut(&mut deps).unwrap().adapters.projector_factory =
        Some(|| Box::new(mainframe_display::incremental::IncrementalProjector::new()));
    *deps.adapters.history.lock().unwrap() = Some(
        (0..500)
            .map(|n| {
                let mut message = numbered_message(n);
                if n % 2 == 0 {
                    message.r#type = ChatMessageType::User;
                }
                message
            })
            .collect(),
    );
    *deps.adapters.transcript_present.lock().unwrap() = Some(true);
    let manager = ChatManager::new(deps);
    let pointer = manager
        .read_resume_snapshot("c1", |messages, _, _| {
            assert_eq!(messages.len(), 500);
            messages[0].content.as_ptr() as usize
        })
        .await;
    let (next_pointer, window) = manager
        .read_resume_snapshot("c1", |messages, _, _| {
            (
                messages[0].content.as_ptr() as usize,
                messages[460..].to_vec(),
            )
        })
        .await;
    assert_eq!(
        pointer, next_pointer,
        "warm snapshots borrow the same settled container storage"
    );
    assert_eq!(window.len(), 40);
    assert_eq!(
        window[0].content,
        vec![mainframe_types::display::DisplayContent::Leaf(
            LeafContent::Text {
                text: "460".into(),
                parent_tool_use_id: None
            }
        )]
    );
}
