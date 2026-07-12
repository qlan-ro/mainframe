//! files.append / files.write / files.read (T6.4, Node actions/files.ts).
//! Contract §5: append/write have no outputs; read exposes `content` only
//! (text, or trimmed non-empty lines with `outputAs: "lines"`).

use serde::Deserialize;
use serde_json::{Value, json};

use crate::domain::OutputAs;
use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::{Action, ActionCtx, ActionError, ActionOutputs, expand_user_path, parse_input};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteInput {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadInput {
    path: String,
    #[serde(default)]
    output_as: Option<OutputAs>,
}

pub struct FilesAppendAction;
pub struct FilesWriteAction;
pub struct FilesReadAction;

impl Action for FilesAppendAction {
    fn manifest(&self) -> ActionManifest {
        write_manifest("files.append", "Append to file", false)
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            let input: WriteInput = parse_input("files.append", params)?;
            let resolved = expand_user_path(&input.path);
            ensure_parent_dir(&resolved)
                .await
                .map_err(|err| io_error("files.append", &input.path, &err))?;
            let mut options = tokio::fs::OpenOptions::new();
            options.append(true).create(true);
            let file = options
                .open(&resolved)
                .await
                .map_err(|err| io_error("files.append", &input.path, &err))?;
            append_all(file, input.content.as_bytes())
                .await
                .map_err(|err| io_error("files.append", &input.path, &err))?;
            Ok(ActionOutputs::new())
        })
    }
}

impl Action for FilesWriteAction {
    fn manifest(&self) -> ActionManifest {
        // Truncating write is restart-safe (Node ships idempotent: true) —
        // blindly re-running converges on the same file body.
        write_manifest("files.write", "Write file (overwrite)", true)
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            let input: WriteInput = parse_input("files.write", params)?;
            let resolved = expand_user_path(&input.path);
            ensure_parent_dir(&resolved)
                .await
                .map_err(|err| io_error("files.write", &input.path, &err))?;
            tokio::fs::write(&resolved, input.content.as_bytes())
                .await
                .map_err(|err| io_error("files.write", &input.path, &err))?;
            Ok(ActionOutputs::new())
        })
    }
}

impl Action for FilesReadAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "files.read",
            title: "Read file",
            group: ActionGroup::Builtin,
            auth: ActionAuth::None,
            credential_label_hint: None,
            params_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "outputAs": {"type": "string", "enum": ["text", "lines"]}
                },
                "required": ["path"],
                "additionalProperties": false
            }),
            outputs: vec![ActionOutput::new("content", ActionOutputType::Text)],
            idempotent: true,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            let input: ReadInput = parse_input("files.read", params)?;
            let resolved = expand_user_path(&input.path);
            let raw = tokio::fs::read_to_string(&resolved)
                .await
                .map_err(|err| io_error("files.read", &input.path, &err))?;
            let content = match input.output_as {
                Some(OutputAs::Lines) => TokenValue::List(
                    raw.split('\n')
                        .map(str::trim)
                        .filter(|line| !line.is_empty())
                        .map(|line| TokenValue::Text(line.to_string()))
                        .collect(),
                ),
                _ => TokenValue::Text(raw),
            };
            let mut outputs = ActionOutputs::new();
            outputs.insert("content".to_string(), content);
            Ok(outputs)
        })
    }
}

async fn ensure_parent_dir(path: &std::path::Path) -> std::io::Result<()> {
    match path.parent() {
        Some(parent) => tokio::fs::create_dir_all(parent).await,
        None => Ok(()),
    }
}

async fn append_all(mut file: tokio::fs::File, bytes: &[u8]) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    file.write_all(bytes).await?;
    file.flush().await
}

fn io_error(action_id: &str, path: &str, err: &std::io::Error) -> ActionError {
    ActionError(format!("{action_id} failed for '{path}': {err}"))
}

fn write_manifest(id: &'static str, title: &'static str, idempotent: bool) -> ActionManifest {
    ActionManifest {
        id,
        title,
        group: ActionGroup::Builtin,
        auth: ActionAuth::None,
        credential_label_hint: None,
        params_schema: json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"}
            },
            "required": ["path", "content"],
            "additionalProperties": false
        }),
        outputs: vec![],
        idempotent,
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.4), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/files.ts; files.write idempotent:true follows
//        the shipped Node engine (plan text said false — cross-engine
//        restart-policy parity wins, and a truncating write IS safe).
