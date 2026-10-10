//! The generated params schemas are wire output (`GET /api/automation-actions`)
//! and the UI's catalog fixtures mirror them, so each one is pinned here to the
//! exact JSON the actions authored by hand before `ActionManifest::new`
//! generated it, together with the editor field order and `has_output_as`.

use serde_json::{Value, json};

use super::known_manifest;

fn assert_manifest(id: &str, schema: Value, field_keys: &[&str], has_output_as: bool) {
    let manifest = known_manifest(id).unwrap_or_else(|| panic!("{id} is not a launch action"));
    assert_eq!(manifest.params_schema, schema, "{id}: params schema");
    let keys: Vec<&str> = manifest.fields.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys, field_keys, "{id}: editor fields");
    assert_eq!(manifest.has_output_as, has_output_as, "{id}: hasOutputAs");
}

#[test]
fn builtin_schemas_match_the_authored_wire_json() {
    let chip_part = |key: &str| {
        json!({
            "type": "object",
            "properties": {key: {"type": "string"}},
            "required": [key],
            "additionalProperties": false
        })
    };
    assert_manifest(
        "run_command",
        json!({
            "type": "object",
            "properties": {
                "script": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"anyOf": [chip_part("literal"), chip_part("chip")]}
                },
                "runIn": {"type": "string", "enum": ["project root", "worktree", "custom"]},
                "customPath": {"type": "string"},
                "outputAs": {"type": "string", "enum": ["text", "lines"]}
            },
            "required": ["script", "runIn"],
            "additionalProperties": false
        }),
        &["script", "runIn", "customPath"],
        true,
    );
    let write_schema = json!({
        "type": "object",
        "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
        "required": ["path", "content"],
        "additionalProperties": false
    });
    assert_manifest(
        "files.append",
        write_schema.clone(),
        &["path", "content"],
        false,
    );
    assert_manifest("files.write", write_schema, &["path", "content"], false);
    assert_manifest(
        "files.read",
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "outputAs": {"type": "string", "enum": ["text", "lines"]}
            },
            "required": ["path"],
            "additionalProperties": false
        }),
        &["path"],
        true,
    );
    assert_manifest(
        "http.request",
        json!({
            "type": "object",
            "properties": {
                "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"], "default": "GET"},
                "url": {"type": "string", "format": "uri"},
                "headers": {"type": "object", "additionalProperties": {"type": "string"}},
                "body": {"anyOf": [{"type": "string"}, {"type": "object"}, {"type": "array"}]},
                "timeoutMs": {"type": "integer", "minimum": 1, "maximum": 120000, "default": 30000}
            },
            "required": ["url"],
            "additionalProperties": false
        }),
        &["method", "url", "body"],
        false,
    );
}

#[test]
fn connector_schemas_match_the_authored_wire_json() {
    assert_manifest(
        "github.create_pr",
        json!({
            "type": "object",
            "properties": {
                "repo": {"type": "string", "minLength": 1},
                "title": {"type": "string", "minLength": 1},
                "body": {"type": "string", "default": ""},
                "head": {"type": "string", "minLength": 1},
                "base": {"type": "string", "minLength": 1}
            },
            "required": ["repo", "title", "head", "base"],
            "additionalProperties": false
        }),
        &["repo", "title", "body", "head", "base"],
        false,
    );
    assert_manifest(
        "github.list_prs",
        json!({
            "type": "object",
            "properties": {"author": {"type": "string", "default": "@me"}},
            "additionalProperties": false
        }),
        &["author"],
        false,
    );
    assert_manifest(
        "notion.add_row",
        json!({
            "type": "object",
            "properties": {"databaseId": {"type": "string", "minLength": 1}},
            "required": ["databaseId"],
            "additionalProperties": {"type": "string"}
        }),
        &["databaseId"],
        false,
    );
    assert_manifest(
        "ado.create_item",
        json!({
            "type": "object",
            "properties": {
                "org": {"type": "string", "minLength": 1},
                "project": {"type": "string", "minLength": 1},
                "type": {"type": "string", "minLength": 1},
                "title": {"type": "string", "minLength": 1},
                "description": {"type": "string", "default": ""}
            },
            "required": ["org", "project", "type", "title"],
            "additionalProperties": false
        }),
        &["org", "project", "type", "title", "description"],
        false,
    );
}
