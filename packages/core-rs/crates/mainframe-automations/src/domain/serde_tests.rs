//! T1.1 — serde round-trips per variant with EXACT contract §1 wire names,
//! deny_unknown_fields, defaults, and the A9 `attachments` literal.

use serde_json::{Value, json};

use super::*;

fn roundtrip<T>(raw: Value) -> T
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let parsed: T = serde_json::from_value(raw.clone()).unwrap();
    let back = serde_json::to_value(&parsed).unwrap();
    assert_eq!(back, raw, "serialized form must match the wire literal");
    parsed
}

#[test]
fn token_ref_is_flat_and_field_is_optional() {
    let with_field: TokenRef = roundtrip(json!({
        "stepId": "trigger", "output": "payload", "field": "pull_request.html_url"
    }));
    assert_eq!(with_field.step_id, TOKEN_STEP_TRIGGER);
    let bare: TokenRef = roundtrip(json!({"stepId": "builtin", "output": "today"}));
    assert_eq!(bare.field, None);
    assert!(
        serde_json::from_value::<TokenRef>(json!({
            "stepId": "s", "output": "o", "kind": "step"
        }))
        .is_err(),
        "TokenRef must reject unknown fields (no tagged kinds)"
    );
}

#[test]
fn chip_part_is_an_untagged_string_or_token_union() {
    let text: ChipPart = roundtrip(json!("literal text"));
    assert_eq!(text, ChipPart::Text("literal text".into()));
    let token: ChipPart = roundtrip(json!({"token": {"stepId": "a", "output": "result"}}));
    assert!(matches!(token, ChipPart::Token { .. }));
    assert!(
        serde_json::from_value::<ChipPart>(
            json!({"token": {"stepId": "a", "output": "r"}, "x": 1})
        )
        .is_err(),
        "extra keys beside `token` must not match the token variant"
    );
    assert!(serde_json::from_value::<ChipPart>(json!({"text": "tagged form"})).is_err());
}

#[test]
fn ask_agent_step_round_trips_every_field() {
    let step: Step = roundtrip(json!({
        "id": "pick-feature",
        "kind": "ask_agent",
        "prompt": ["Do the thing for ", {"token": {"stepId": "builtin", "output": "today"}}],
        "adapterId": "claude",
        "model": "opus",
        "permissionMode": "acceptEdits",
        "projectId": "proj-1",
        "worktree": {"baseBranch": "main", "branchName": ["spike-", {"token": {"stepId": "builtin", "output": "today"}}]},
        "autoApprove": ["edits", "pnpm"],
        "timeoutMinutes": 240,
        "expects": [{"key": "scope", "type": "choice", "options": ["xs", "s", "m"]}]
    }));
    let Step::AskAgent(agent) = step else {
        panic!("expected ask_agent")
    };
    assert!(!agent.keep_going, "keepGoing defaults false");
    assert_eq!(agent.timeout_minutes, Some(240));
    assert_eq!(
        agent.expects.as_deref().unwrap()[0].output_type,
        ExpectedOutputType::Choice
    );
}

#[test]
fn ask_agent_attachments_a9_round_trips_and_skips_when_absent() {
    let step: Step = roundtrip(json!({
        "id": "with-files",
        "kind": "ask_agent",
        "prompt": ["review these"],
        "attachments": ["design.png", "notes/spec.md"]
    }));
    let Step::AskAgent(agent) = step else {
        panic!("expected ask_agent")
    };
    assert_eq!(
        agent.attachments.as_deref(),
        Some(["design.png".to_string(), "notes/spec.md".to_string()].as_slice())
    );
    let bare: Step = roundtrip(json!({"id": "plain", "kind": "ask_agent", "prompt": ["go"]}));
    let serialized = serde_json::to_value(&bare).unwrap();
    assert!(
        serialized.get("attachments").is_none(),
        "absent attachments stay absent"
    );
}

#[test]
fn ask_me_step_uses_show_when_and_optional_required() {
    let step: Step = roundtrip(json!({
        "id": "ask-health",
        "kind": "ask_me",
        "title": "Health check-in",
        "fields": [
            {"key": "mood", "type": "choice", "label": "Mood", "options": ["great", "bad"], "required": true},
            {"key": "other", "type": "textarea", "label": "Other", "showWhen": {"key": "mood", "equals": "bad"}}
        ]
    }));
    let Step::AskMe(ask) = step else {
        panic!("expected ask_me")
    };
    assert!(ask.fields[0].required);
    assert!(!ask.fields[1].required, "required defaults false");
    assert_eq!(ask.fields[1].show_when.as_ref().unwrap().equals, "bad");
    assert!(
        serde_json::from_value::<AutomationFormField>(json!({
            "key": "x", "type": "text", "when": {"key": "a", "equals": "b"}
        }))
        .is_err(),
        "the wire name is showWhen, not when"
    );
}

#[test]
fn run_action_step_params_are_all_chip_texts() {
    let step: Step = roundtrip(json!({
        "id": "log-notion",
        "kind": "run_action",
        "actionId": "notion.add_row",
        "credential": "notion-main",
        "params": {
            "Mood": [{"token": {"stepId": "ask-health", "output": "mood"}}],
            "databaseId": ["Health Log"]
        },
        "outputAs": "lines"
    }));
    let Step::RunAction(action) = step else {
        panic!("expected run_action")
    };
    assert_eq!(action.action_id, "notion.add_row");
    assert_eq!(action.output_as, Some(OutputAs::Lines));
    assert_eq!(action.params.len(), 2);
}

#[test]
fn notify_if_and_repeat_round_trip_with_wire_names() {
    let notify: Step = roundtrip(json!({
        "id": "notify-skip", "kind": "notify", "message": ["Skipped."], "keepGoing": true
    }));
    assert!(notify.keep_going(), "explicit keepGoing:true survives");

    let if_step: Step = roundtrip(json!({
        "id": "if-in-scope",
        "kind": "if",
        "match": "all",
        "conditions": [
            {"token": {"stepId": "pick", "output": "scope"}, "comparator": "is_one_of", "value": ["xs", "s"]}
        ],
        "then": [{"id": "n1", "kind": "notify", "message": ["yes"]}],
        "otherwise": []
    }));
    let Step::If(if_block) = if_step else {
        panic!("expected if")
    };
    assert_eq!(if_block.match_mode, ConditionMatch::All);
    assert_eq!(if_block.conditions[0].comparator, Comparator::IsOneOf);

    let repeat: Step = roundtrip(json!({
        "id": "repeat-prs",
        "kind": "repeat",
        "items": {"stepId": "list-open-prs", "output": "prs"},
        "steps": [{"id": "inner", "kind": "notify", "message": [
            {"token": {"stepId": "current", "output": "item", "field": "url"}}
        ]}]
    }));
    let Step::Repeat(repeat_block) = repeat else {
        panic!("expected repeat")
    };
    assert_eq!(repeat_block.items.output, "prs");
}

#[test]
fn steps_reject_unknown_fields_but_accept_the_kind_tag() {
    assert!(
        serde_json::from_value::<Step>(json!({
            "id": "n", "kind": "notify", "message": [], "bogus": 1
        }))
        .is_err(),
        "unknown fields on a step must be rejected"
    );
    assert!(
        serde_json::from_value::<Step>(json!({
            "id": "n", "kind": "does_not_exist", "message": []
        }))
        .is_err(),
        "unknown step kinds must be rejected"
    );
}

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
