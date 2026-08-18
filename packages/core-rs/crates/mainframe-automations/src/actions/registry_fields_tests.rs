//! Part 0 of the 2026-08-18 automations-provider-connections plan — the
//! field-schema/idempotent projection this crate didn't carry before: an
//! empty `fields` list on the wire is exactly the bug that made `run_action`
//! render a blank form, so these are the regression net for that gap, split
//! out of `registry_tests.rs` to stay under the file line cap.

use super::ActionRegistry;

/// Every registered action's field-schema keys must be a subset of its own
/// JSON-Schema `properties` keys, or the editor would render a control that
/// patches a param the action's `parse_input` never reads.
#[test]
fn field_schema_keys_are_a_subset_of_the_json_schema_properties() {
    let mut registry = ActionRegistry::new();
    super::register_all_actions(&mut registry).unwrap();

    for manifest in registry.catalog() {
        let properties = manifest.params_schema["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{}: params_schema has no 'properties' object", manifest.id));
        for field in &manifest.fields {
            assert!(
                properties.contains_key(&field.key),
                "{}: field '{}' has no matching params_schema property",
                manifest.id,
                field.key
            );
        }
    }
}

/// Every one of the 9 launch actions carries a non-empty field schema, and
/// `idempotent` is set deliberately (not just defaulted false by omission)
/// on both a read (true) and a write (false) action.
#[test]
fn every_launch_action_carries_a_field_schema() {
    let mut registry = ActionRegistry::new();
    super::register_all_actions(&mut registry).unwrap();

    let catalog = registry.catalog();
    assert_eq!(catalog.len(), 9);
    for manifest in &catalog {
        assert!(
            !manifest.fields.is_empty(),
            "{}: no field schema — the editor would render an empty form",
            manifest.id
        );
    }

    let files_read = catalog.iter().find(|m| m.id == "files.read").unwrap();
    assert!(files_read.idempotent);
    assert!(files_read.has_output_as);

    let github_create_pr = catalog.iter().find(|m| m.id == "github.create_pr").unwrap();
    assert!(!github_create_pr.idempotent);
}
