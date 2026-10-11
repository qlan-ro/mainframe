use super::*;
use serde_json::{Value, json};

/// Extract the event object(s) from a golden fixture: strips `_provenance`
/// and returns the `minimal`/`full` variants, or the flat event itself.
fn events_from_fixture(raw: &str) -> Vec<Value> {
    let mut root: Value = serde_json::from_str(raw).unwrap();
    let obj = root.as_object_mut().unwrap();
    obj.remove("_provenance");
    if obj.contains_key("minimal") || obj.contains_key("full") {
        let mut out = Vec::new();
        if let Some(m) = obj.remove("minimal") {
            out.push(m);
        }
        if let Some(f) = obj.remove("full") {
            out.push(f);
        }
        out
    } else {
        vec![Value::Object(obj.clone())]
    }
}

/// Canonicalize every JSON number to f64 so that a fixture's integer-literal
/// `0` for an f64 field (e.g. `totalCost`) compares equal to Rust's `0.0`.
/// All fixture numbers are < 2^53, so f64 is lossless here.
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => n.as_f64().map(|f| json!(f)).unwrap_or_else(|| v.clone()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, val)| (k.clone(), norm(val))).collect())
        }
        _ => v.clone(),
    }
}

fn assert_daemon_roundtrip(raw: &str) {
    for ev in events_from_fixture(raw) {
        let parsed: DaemonEvent = serde_json::from_value(ev.clone())
            .map_err(|e| format!("deserialize failed: {e}\n{ev:#}"))
            .unwrap();
        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(norm(&ev), norm(&back), "round-trip mismatch");
    }
}

// ── Representative fixtures across variant families ─────────────────────
#[test]
fn fixture_chat_updated() {
    assert_daemon_roundtrip(include_str!("../tests/fixtures/event.chat-updated.json"));
}

#[test]
fn fixture_background_task_updated() {
    assert_daemon_roundtrip(include_str!(
        "../tests/fixtures/event.background_task-updated.json"
    ));
}

#[test]
fn fixture_connection_ready() {
    assert_daemon_roundtrip(include_str!(
        "../tests/fixtures/event.connection-ready.json"
    ));
}

#[test]
fn fixture_chat_created() {
    assert_daemon_roundtrip(include_str!("../tests/fixtures/event.chat-created.json"));
}

#[test]
fn fixture_context_updated() {
    assert_daemon_roundtrip(include_str!("../tests/fixtures/event.context-updated.json"));
}

#[test]
fn fixture_process_started() {
    assert_daemon_roundtrip(include_str!("../tests/fixtures/event.process-started.json"));
}

#[test]
fn fixture_adapter_models_updated() {
    assert_daemon_roundtrip(include_str!(
        "../tests/fixtures/event.adapter-models-updated.json"
    ));
}

#[test]
fn fixture_tunnel_status() {
    assert_daemon_roundtrip(include_str!("../tests/fixtures/event.tunnel-status.json"));
}

#[test]
fn fixture_error() {
    assert_daemon_roundtrip(include_str!("../tests/fixtures/event.error.json"));
}

#[test]
fn fixture_worktree_offer_raised() {
    assert_daemon_roundtrip(include_str!(
        "../tests/fixtures/event.worktree-offer-raised.json"
    ));
}

#[test]
fn fixture_worktree_offer_resolved() {
    assert_daemon_roundtrip(include_str!(
        "../tests/fixtures/event.worktree-offer-resolved.json"
    ));
}

#[test]
fn fixture_worktree_offer_snapshot() {
    assert_daemon_roundtrip(include_str!(
        "../tests/fixtures/event.worktree-offer-snapshot.json"
    ));
}

// ── ClientEvent shapes (no captured fixtures; from the TS union) ─────────
fn assert_client_roundtrip(v: Value) {
    let parsed: ClientEvent = serde_json::from_value(v.clone()).unwrap();
    let back = serde_json::to_value(&parsed).unwrap();
    assert_eq!(v, back);
}

// ── Automations v2 events (no captured fixtures yet; the
// expected JSON below IS the ratified wire shape) ────────────────────────
fn assert_daemon_wire(event: DaemonEvent, expected: Value) {
    let serialized = serde_json::to_value(&event).unwrap();
    assert_eq!(serialized, expected, "wire shape mismatch");
    let parsed: DaemonEvent = serde_json::from_value(expected).unwrap();
    assert_eq!(parsed, event, "round-trip mismatch");
}

#[test]
fn automation_run_updated_wire_shape() {
    use crate::automation::*;
    assert_daemon_wire(
        DaemonEvent::AutomationRunUpdated {
            run: AutomationRunSummary {
                id: "run_1".into(),
                automation_id: "auto_1".into(),
                status: AutomationRunStatus::Waiting,
                trigger: AutomationRunTrigger {
                    kind: AutomationTriggerKind::Schedule,
                    tokens: None,
                },
                started_at: 1,
                finished_at: None,
                error: None,
            },
        },
        json!({
            "type": "automation.run.updated",
            "run": {
                "id": "run_1",
                "automationId": "auto_1",
                "status": "waiting",
                "trigger": { "kind": "schedule" },
                "startedAt": 1,
                "finishedAt": null,
                "error": null
            }
        }),
    );
}

#[test]
fn automation_interaction_created_wire_shape() {
    use crate::automation::*;
    assert_daemon_wire(
        DaemonEvent::AutomationInteractionCreated {
            interaction: AutomationInteractionSummary {
                id: "int_1".into(),
                run_id: "run_1".into(),
                step_ref: "ask#0".into(),
                title: "Daily check-in".into(),
                fields: vec![AutomationFormField {
                    key: "mood".into(),
                    field_type: AutomationFormFieldType::Choice,
                    label: None,
                    options: Some(vec!["good".into(), "bad".into()]),
                    required: None,
                    show_when: Some(AutomationShowWhen {
                        key: "action".into(),
                        equals: "log".into(),
                    }),
                }],
                status: AutomationInteractionStatus::Pending,
                created_at: 2,
                resolved_at: None,
            },
        },
        json!({
            "type": "automation.interaction.created",
            "interaction": {
                "id": "int_1",
                "runId": "run_1",
                "stepRef": "ask#0",
                "title": "Daily check-in",
                "fields": [{
                    "key": "mood",
                    "type": "choice",
                    "options": ["good", "bad"],
                    "showWhen": { "key": "action", "equals": "log" }
                }],
                "status": "pending",
                "createdAt": 2,
                "resolvedAt": null
            }
        }),
    );
}

#[test]
fn automation_interaction_resolved_wire_shape() {
    assert_daemon_wire(
        DaemonEvent::AutomationInteractionResolved {
            interaction_id: "int_1".into(),
            run_id: "run_1".into(),
        },
        json!({
            "type": "automation.interaction.resolved",
            "interactionId": "int_1",
            "runId": "run_1"
        }),
    );
}

#[test]
fn automation_completed_wire_shape() {
    use crate::automation::AutomationCompletedStatus;
    assert_daemon_wire(
        DaemonEvent::AutomationCompleted {
            automation_id: "auto_1".into(),
            automation_name: "Daily standup".into(),
            run_id: "run_1".into(),
            status: AutomationCompletedStatus::Succeeded,
            result: "done".into(),
        },
        json!({
            "type": "automation.completed",
            "automationId": "auto_1",
            "automationName": "Daily standup",
            "runId": "run_1",
            "status": "succeeded",
            "result": "done"
        }),
    );
}

#[test]
fn automation_notification_wire_shape() {
    use crate::automation::AutomationNotificationLinks;
    assert_daemon_wire(
        DaemonEvent::AutomationNotification {
            run_id: "run_1".into(),
            automation_id: "auto_1".into(),
            title: "Daily standup".into(),
            body: "Standup posted".into(),
            links: AutomationNotificationLinks {
                run_id: "run_1".into(),
                chat_ids: vec!["chat_1".into()],
            },
        },
        json!({
            "type": "automation.notification",
            "runId": "run_1",
            "automationId": "auto_1",
            "title": "Daily standup",
            "body": "Standup posted",
            "links": { "runId": "run_1", "chatIds": ["chat_1"] }
        }),
    );
}
