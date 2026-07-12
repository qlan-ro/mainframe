//! T1.1 (continued) — trigger, comparator, condition-value, and definition
//! round-trips. Step-level round-trips live in serde_tests.rs.

use serde_json::json;

use super::serde_tests::roundtrip;
use super::*;

#[test]
fn all_ten_comparators_use_contract_names() {
    let names = [
        "is",
        "is_not",
        "contains",
        "starts_with",
        "eq",
        "lt",
        "gt",
        "is_empty",
        "not_empty",
        "is_one_of",
    ];
    for name in names {
        let parsed: Comparator = serde_json::from_value(json!(name)).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), json!(name));
    }
    assert!(serde_json::from_value::<Comparator>(json!("equals")).is_err());
}

#[test]
fn condition_value_preserves_authored_number_form() {
    let row: ConditionRow = roundtrip(json!({
        "token": {"stepId": "s", "output": "n"}, "comparator": "lt", "value": 5
    }));
    assert!(matches!(row.value, Some(ConditionValue::Number(_))));
    let empty: ConditionRow = roundtrip(json!({
        "token": {"stepId": "s", "output": "list"}, "comparator": "is_empty"
    }));
    assert_eq!(empty.value, None);
}

#[test]
fn schedule_trigger_round_trips_every_pattern() {
    for pattern in [
        json!({"type": "daily", "at": "21:00"}),
        json!({"type": "weekdays", "at": "06:00"}),
        json!({"type": "weekly", "days": [1, 3, 5], "at": "09:30"}),
        json!({"type": "every_n_hours", "n": 6}),
    ] {
        let trigger: Trigger = roundtrip(json!({
            "id": "t1", "kind": "schedule", "schedule": pattern, "onMissed": "run_once"
        }));
        assert_eq!(trigger.id(), "t1");
    }
    let skip: Trigger = roundtrip(json!({
        "id": "t2", "kind": "schedule", "schedule": {"type": "daily", "at": "08:00"}, "onMissed": "skip"
    }));
    let Trigger::Schedule(schedule) = skip else {
        panic!("expected schedule")
    };
    assert_eq!(schedule.on_missed, OnMissed::Skip);
}

#[test]
fn event_and_webhook_triggers_round_trip() {
    for event in [
        "session.finished",
        "automation.finished",
        "automation.failed",
    ] {
        let trigger: Trigger = roundtrip(json!({
            "id": "e1", "kind": "event", "event": event, "automationId": "auto-1"
        }));
        assert!(matches!(trigger, Trigger::Event(_)));
    }
    let webhook: Trigger = roundtrip(json!({
        "id": "w1", "kind": "webhook", "hookId": "github-pr-opened", "preset": "github_pr_opened"
    }));
    let Trigger::Webhook(hook) = webhook else {
        panic!("expected webhook")
    };
    assert_eq!(hook.hook_id, "github-pr-opened");
    assert!(
        serde_json::from_value::<Trigger>(json!({
            "id": "w2", "kind": "webhook", "hookId": "h", "secret": "nope"
        }))
        .is_err(),
        "webhook triggers must not carry secrets in the definition"
    );
}

#[test]
fn definition_and_create_input_round_trip() {
    let input: AutomationCreateInput = roundtrip(json!({
        "name": "Daily standup",
        "description": "Morning plan",
        "scope": "global",
        "definition": {
            "triggers": [{"id": "t", "kind": "schedule", "schedule": {"type": "daily", "at": "08:00"}, "onMissed": "skip"}],
            "steps": [{"id": "ask", "kind": "ask_agent", "prompt": ["/pending-work"]}]
        }
    }));
    assert_eq!(input.scope, AutomationScope::Global);
    assert_eq!(input.definition.steps.len(), 1);
    assert!(
        serde_json::from_value::<AutomationDefinition>(json!({
            "triggers": [], "steps": [], "name": "smuggled"
        }))
        .is_err(),
        "definition rejects unknown fields"
    );
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: wire literals mirror packages/types/fixtures/automations/ shapes.
