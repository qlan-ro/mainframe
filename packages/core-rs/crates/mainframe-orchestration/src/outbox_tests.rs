use super::*;

#[test]
fn take_for_batches_only_the_target_in_order() {
    let outbox = Outbox::new();
    outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
    outbox.push("other", "a", OutboxKind::Send, "x".into(), "x");
    outbox.push("t", "b", OutboxKind::Send, "two".into(), "two");
    let taken = outbox.take_for("t");
    assert_eq!(batch_body(&taken), "one\n\ntwo");
    assert!(!outbox.has_for("t"));
    assert!(outbox.has_for("other"));
}

#[test]
fn cancel_and_drop_remove_entries() {
    let outbox = Outbox::new();
    let id = outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
    outbox.push(
        "p",
        "c",
        OutboxKind::TaskResult {
            task_id: "k".into(),
        },
        "r".into(),
        "r",
    );
    assert!(!outbox.cancel("t", "nope"));
    assert!(outbox.cancel("t", &id));
    outbox.drop_task("k");
    assert!(outbox.targets().is_empty());
}

#[test]
fn every_change_reports_its_target_once() {
    let seen = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
    let outbox = {
        let seen = std::sync::Arc::clone(&seen);
        Outbox::observed(move |t| seen.lock().unwrap().push(t.to_string()))
    };
    let id = outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
    outbox.push(
        "p",
        "c",
        OutboxKind::TaskResult {
            task_id: "k".into(),
        },
        "r".into(),
        "r",
    );
    assert!(outbox.cancel("t", &id));
    assert!(!outbox.cancel("t", &id));
    outbox.drop_task("k");
    assert!(outbox.take_for("p").is_empty());
    outbox.push("t", "a", OutboxKind::Send, "two".into(), "two");
    let taken = outbox.take_for("t");
    outbox.restore(taken);
    assert_eq!(
        *seen.lock().unwrap(),
        vec!["t", "p", "t", "p", "t", "t", "t"]
    );
}

#[test]
fn restore_puts_entries_back_first() {
    let outbox = Outbox::new();
    outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
    let taken = outbox.take_for("t");
    outbox.push("t", "a", OutboxKind::Send, "two".into(), "two");
    outbox.restore(taken);
    assert_eq!(batch_body(&outbox.take_for("t")), "one\n\ntwo");
}
