//! T6.2 — flat-id action registry: catalog contents, output-type enum wire
//! names, idempotent flag, duplicate/unknown id errors.

use std::collections::BTreeMap;

use serde_json::json;

use crate::engine::BoxFuture;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::registry::ActionRegistry;
use super::{Action, ActionCtx, ActionError, ActionOutputs};

struct FakeAction {
    manifest: ActionManifest,
}

impl FakeAction {
    fn new(id: &'static str, idempotent: bool, outputs: Vec<ActionOutput>) -> Self {
        Self {
            manifest: ActionManifest {
                id,
                title: "Fake",
                group: ActionGroup::Builtin,
                auth: ActionAuth::None,
                credential_label_hint: None,
                params_schema: json!({"type": "object"}),
                outputs,
                idempotent,
            },
        }
    }
}

impl Action for FakeAction {
    fn manifest(&self) -> ActionManifest {
        self.manifest.clone()
    }

    fn execute<'a>(
        &'a self,
        _params: &'a serde_json::Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async { Ok(BTreeMap::new()) })
    }
}

#[test]
fn catalog_lists_registered_actions_in_registration_order() {
    let mut registry = ActionRegistry::new();
    registry
        .register(Box::new(FakeAction::new(
            "b.second",
            true,
            vec![ActionOutput::new("content", ActionOutputType::Text)],
        )))
        .unwrap();
    registry
        .register(Box::new(FakeAction::new("a.first", false, vec![])))
        .unwrap();

    let catalog = registry.catalog();
    assert_eq!(
        catalog.iter().map(|m| m.id).collect::<Vec<_>>(),
        vec!["b.second", "a.first"],
        "catalog preserves registration order, not alphabetical"
    );
    assert_eq!(
        catalog[0].outputs,
        vec![ActionOutput::new("content", ActionOutputType::Text)]
    );
    // A no-output action has an empty outputs list, never a `none` type.
    assert!(catalog[1].outputs.is_empty());
}

#[test]
fn output_type_enum_is_exactly_text_number_list_record() {
    for (ty, wire) in [
        (ActionOutputType::Text, "\"text\""),
        (ActionOutputType::Number, "\"number\""),
        (ActionOutputType::List, "\"list\""),
        (ActionOutputType::Record, "\"record\""),
    ] {
        assert_eq!(serde_json::to_string(&ty).unwrap(), wire);
    }
    // `none` was dropped by contract §5 — it must not deserialize.
    assert!(serde_json::from_str::<ActionOutputType>("\"none\"").is_err());
}

#[test]
fn duplicate_id_is_an_error() {
    let mut registry = ActionRegistry::new();
    registry
        .register(Box::new(FakeAction::new("run_command", false, vec![])))
        .unwrap();
    let err = registry
        .register(Box::new(FakeAction::new("run_command", false, vec![])))
        .unwrap_err();
    assert_eq!(err.to_string(), "duplicate action id 'run_command'");
}

#[test]
fn unknown_id_is_an_error() {
    let registry = ActionRegistry::new();
    let err = registry.resolve("nope.nothing").err().unwrap();
    assert_eq!(err.to_string(), "unknown action 'nope.nothing'");
}

/// Cross-check: every built-in's manifest outputs match the frozen contract
/// §5 table already encoded in `domain::catalog` (names AND order).
#[test]
fn builtin_catalog_matches_the_contract_output_table() {
    let mut registry = ActionRegistry::new();
    super::register_builtin_actions(&mut registry).unwrap();

    let catalog = registry.catalog();
    assert_eq!(
        catalog.iter().map(|m| m.id).collect::<Vec<_>>(),
        vec![
            "run_command",
            "files.append",
            "files.write",
            "files.read",
            "http.request",
        ]
    );
    for manifest in &catalog {
        let expected = crate::domain::catalog::action_outputs(manifest.id);
        let actual: Vec<(&str, &str)> = manifest
            .outputs
            .iter()
            .map(|o| {
                (
                    o.name.as_str(),
                    match o.output_type {
                        ActionOutputType::Text => "text",
                        ActionOutputType::Number => "number",
                        ActionOutputType::List => "list",
                        ActionOutputType::Record => "record",
                    },
                )
            })
            .collect();
        let expected: Vec<(&str, &str)> = expected
            .iter()
            .map(|(name, ty)| (*name, ty.describe()))
            .collect();
        assert_eq!(actual, expected, "outputs drifted for '{}'", manifest.id);
    }
}

#[test]
fn is_idempotent_reads_the_manifest_and_defaults_false() {
    let mut registry = ActionRegistry::new();
    registry
        .register(Box::new(FakeAction::new("safe.read", true, vec![])))
        .unwrap();
    registry
        .register(Box::new(FakeAction::new("effectful.write", false, vec![])))
        .unwrap();

    assert!(registry.is_idempotent("safe.read"));
    assert!(!registry.is_idempotent("effectful.write"));
    // Unregistered ids are treated as non-idempotent (Decision 12).
    assert!(!registry.is_idempotent("unknown.id"));
}
