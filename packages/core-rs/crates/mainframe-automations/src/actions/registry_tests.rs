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

/// T7.3 — the wire `ActionCatalogEntry` shape (GET /api/automation-actions):
/// camelCase keys, `credentialLabelHint` omitted when absent, `idempotent`
/// dropped (engine-internal).
#[test]
fn wire_catalog_projects_manifests_to_the_contract_shape() {
    let mut registry = ActionRegistry::new();
    super::register_all_actions(&mut registry).unwrap();

    let entries = registry.wire_catalog();
    let json = serde_json::to_value(&entries).unwrap();

    // Launch catalog carries no mcp entries (contract §9).
    assert!(
        entries.iter().all(|e| !e.id.starts_with("mcp:")),
        "no mcp:* entries at launch"
    );

    let run_command = &json[0];
    assert_eq!(run_command["id"], "run_command");
    assert_eq!(run_command["group"], "builtin");
    assert!(
        run_command.get("credentialLabelHint").is_none(),
        "hint omitted when absent"
    );
    assert!(
        run_command.get("idempotent").is_none(),
        "idempotent never crosses the wire"
    );

    let create_pr = json
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "github.create_pr")
        .unwrap();
    assert_eq!(create_pr["group"], "connector");
    assert_eq!(create_pr["auth"], "token");
    assert_eq!(create_pr["credentialLabelHint"], "github");
    assert_eq!(
        create_pr["outputs"],
        json!([
            {"name": "prUrl", "type": "text"},
            {"name": "prNumber", "type": "number"},
        ])
    );
    assert!(create_pr["paramsSchema"].is_object());
}

/// T7.3 — the MCP catalog-entry seam: an `mcp:<server>:<tool>` id with
/// output `{result: text}` round-trips through the wire shape. No MCP
/// client, config source, or `actions/mcp.rs` ships at launch (R5).
#[test]
fn mcp_catalog_entry_shape_round_trips() {
    let entry = super::registry::ActionCatalogEntry::mcp_seam("linear", "create_issue");
    assert_eq!(entry.id, "mcp:linear:create_issue");
    assert_eq!(entry.group, ActionGroup::Mcp);
    assert_eq!(
        entry.outputs,
        vec![ActionOutput::new("result", ActionOutputType::Text)]
    );

    let json = serde_json::to_value(&entry).unwrap();
    assert_eq!(json["id"], "mcp:linear:create_issue");
    assert_eq!(json["group"], "mcp");
    assert_eq!(json["outputs"], json!([{"name": "result", "type": "text"}]));

    let back: super::registry::ActionCatalogEntry = serde_json::from_value(json).unwrap();
    assert_eq!(back, entry);
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
