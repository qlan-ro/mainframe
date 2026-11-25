use super::*;
use serde_json::{Value, json};

fn parse(value: Value) -> ControlUpdate {
    serde_json::from_value(value).unwrap()
}

fn mode(name: &str) -> ControlUpdate {
    parse(json!({ "type": "setMode", "mode": name, "destination": "session" }))
}

fn rule() -> ControlUpdate {
    parse(json!({
        "type": "addRules",
        "rules": [{ "toolName": "Bash", "ruleContent": "cargo test *" }],
        "behavior": "allow",
        "destination": "localSettings"
    }))
}

#[test]
fn no_mode_wider_than_auto_edits_is_grantable() {
    for name in ["default", "plan", "acceptEdits"] {
        assert!(mode(name).grantable(), "{name}");
    }
    for name in [
        "auto",
        "yolo",
        "bypassPermissions",
        "dontAsk",
        "someFutureMode",
    ] {
        assert!(!mode(name).grantable(), "{name}");
    }
    assert!(rule().grantable());
}

#[test]
fn a_shape_it_cannot_read_is_kept_as_it_came_and_never_grantable() {
    for value in [
        json!({ "type": "grantEverything", "destination": "session" }),
        json!({ "type": "addRules", "rules": "Bash", "behavior": "allow", "destination": "session" }),
        json!({ "type": "addRules", "rules": [], "behavior": "allow", "destination": "enterprise" }),
        json!({ "type": "setMode", "mode": "bypassPermissions", "destination": "session" }),
        json!("allow all"),
        json!(null),
    ] {
        let update = parse(value.clone());
        assert_eq!(update, ControlUpdate::Unknown(value.clone()));
        assert!(!update.grantable());
        assert_eq!(serde_json::to_value(&update).unwrap(), value);
    }
}

#[test]
fn one_unreadable_update_does_not_take_the_others_with_it() {
    let updates: Vec<ControlUpdate> =
        serde_json::from_value(json!([rule(), { "type": "someday" }, rule()])).unwrap();
    assert_eq!(updates[0], rule());
    assert_eq!(updates[2], rule());
    assert!(!updates[1].grantable());
}

#[test]
fn withholding_keeps_the_rest_of_the_answer() {
    let mut response: ControlResponse = serde_json::from_value(json!({
        "requestId": "r1",
        "toolUseId": "t1",
        "behavior": "allow",
        "updatedPermissions": [mode("yolo"), rule(), mode("acceptEdits")]
    }))
    .unwrap();

    assert_eq!(response.withhold_ungrantable(), vec![mode("yolo")]);
    assert_eq!(
        response.updated_permissions,
        Some(vec![rule(), mode("acceptEdits")])
    );
    assert!(response.withhold_ungrantable().is_empty());

    response.updated_permissions = None;
    assert!(response.withhold_ungrantable().is_empty());
    assert_eq!(response.updated_permissions, None);
}

#[test]
fn labels_name_the_mode_and_show_nothing_odd_from_the_agent() {
    let label = |update: ControlUpdate| update.withheld_label();
    assert_eq!(label(mode("yolo")), "switching permissions to Unattended");
    assert_eq!(
        label(mode("bypassPermissions")),
        "switching permissions to Unattended"
    );
    assert_eq!(label(mode("auto")), "switching permissions to Auto");
    assert_eq!(label(mode("dontAsk")), "switching permissions to “dontAsk”");
    assert_eq!(label(mode("a\u{202E}b")), "switching permissions");
    assert_eq!(
        label(parse(json!({ "type": "someday" }))),
        "a change that could not be read (someday)"
    );
    assert_eq!(
        label(parse(json!({ "type": "x\ny" }))),
        "a change that could not be read"
    );
}
