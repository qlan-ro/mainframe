//! The generated params schemas and editor fields are wire output
//! (`GET /api/automation-actions`) and the UI's catalog fixtures mirror them,
//! so each one is pinned here to the exact JSON the actions authored by hand
//! before `ActionManifest::new` generated it, together with `has_output_as`.
//! The `fields` literals transcribe those hand-written `ActionField` lists
//! (control, label, placeholder, options, showWhen), not the generator's
//! output, so a generator change that alters any of them fails here.

use serde_json::{Value, json};

use super::known_manifest;

fn assert_manifest(id: &str, schema: Value, fields: Value, has_output_as: bool) {
    let manifest = known_manifest(id).unwrap_or_else(|| panic!("{id} is not a launch action"));
    assert_eq!(manifest.params_schema, schema, "{id}: params schema");
    let wire_fields = serde_json::to_value(&manifest.fields).unwrap();
    assert_eq!(wire_fields, fields, "{id}: editor fields");
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
        json!([
            {"key": "script", "label": "Script", "control": "code", "placeholder": "pnpm test"},
            {
                "key": "runIn",
                "label": "Run in",
                "control": "select",
                "options": ["project root", "worktree", "custom"]
            },
            {
                "key": "customPath",
                "label": "Path",
                "control": "chip",
                "placeholder": "~/code/my-project",
                "showWhen": {"key": "runIn", "equals": "custom"}
            }
        ]),
        true,
    );
    let write_schema = json!({
        "type": "object",
        "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
        "required": ["path", "content"],
        "additionalProperties": false
    });
    let write_fields = json!([
        {"key": "path", "label": "File", "control": "chip", "placeholder": "~/notes/log.md"},
        {"key": "content", "label": "Text", "control": "chiparea"}
    ]);
    assert_manifest(
        "files.append",
        write_schema.clone(),
        write_fields.clone(),
        false,
    );
    assert_manifest("files.write", write_schema, write_fields, false);
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
        json!([
            {"key": "path", "label": "File", "control": "chip", "placeholder": "~/notes/log.md"}
        ]),
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
        json!([
            {
                "key": "method",
                "label": "Method",
                "control": "select",
                "options": ["GET", "POST", "PUT", "PATCH", "DELETE"]
            },
            {
                "key": "url",
                "label": "URL",
                "control": "chip",
                "placeholder": "https://api.example.com/…"
            },
            {"key": "body", "label": "Body", "control": "chiparea"}
        ]),
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
        json!([
            {"key": "repo", "label": "Repository", "control": "text", "placeholder": "org/repo"},
            {"key": "title", "label": "Title", "control": "chip"},
            {"key": "body", "label": "Body", "control": "chiparea"},
            {"key": "head", "label": "Branch", "control": "chip", "placeholder": "feature/…"},
            {"key": "base", "label": "Base branch", "control": "text", "placeholder": "main"}
        ]),
        false,
    );
    assert_manifest(
        "github.list_prs",
        json!({
            "type": "object",
            "properties": {"author": {"type": "string", "default": "@me"}},
            "additionalProperties": false
        }),
        json!([
            {"key": "author", "label": "Author", "control": "text", "placeholder": "@me"}
        ]),
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
        json!([{"key": "databaseId", "label": "Database", "control": "chip"}]),
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
        json!([
            {"key": "org", "label": "Organization", "control": "text", "placeholder": "my-org"},
            {
                "key": "project",
                "label": "Project",
                "control": "text",
                "placeholder": "my-project"
            },
            {
                "key": "type",
                "label": "Type",
                "control": "select",
                "options": ["Task", "Bug", "User Story"]
            },
            {"key": "title", "label": "Title", "control": "chip"},
            {"key": "description", "label": "Description", "control": "chiparea"}
        ]),
        false,
    );
}
