#[test]
fn mark_context_lost_clears_an_unshared_native_id_in_place() {
    let (_dir, db, pid) = open();
    let chat = new_chat(&db, &pid, "claude");
    set_session(&db, &chat.id, "eph");
    db.chats
        .mark_context_lost(&chat.id, "2026-01-01T00:00:00Z")
        .unwrap();
    let row = db.chats.get(&chat.id).unwrap().unwrap();
    assert_eq!(row.vendor_session_id, None);
    assert_eq!(row.context_lost_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(db.segments.layout(&chat.id).unwrap().segments.len(), 1);
}
