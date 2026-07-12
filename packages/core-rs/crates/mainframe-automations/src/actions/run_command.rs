//! `run_command` (T6.3, Node actions/run-command.ts). A1 (contract §6):
//! script chips never touch shell text — each chip becomes its own `MF_<n>`
//! child env var and the script gets a quoted `"$MF_<n>"` where the chip
//! sat; only author-typed literal text is shell source. `cwd` is never
//! shell source either: `custom` is the one mode that runs user text, and
//! it goes through realpath containment against the project root.

use std::process::Stdio;

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::domain::OutputAs;
use crate::tokens::TokenValue;

use super::manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
use super::paths::resolve_and_validate_path;
use super::{Action, ActionCtx, ActionError, ActionOutputs, parse_input};

const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const STDERR_TAIL_CHARS: usize = 4000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LiteralPart {
    literal: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ChipValue {
    chip: String,
}

/// `{literal: string} | {chip: string}` — the run_action verb keeps chip
/// boundaries for this one action instead of joining the ChipText (A1).
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum ScriptPart {
    Literal(LiteralPart),
    Chip(ChipValue),
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) enum RunIn {
    #[serde(rename = "project root")]
    ProjectRoot,
    #[serde(rename = "worktree")]
    Worktree,
    #[serde(rename = "custom")]
    Custom,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunCommandInput {
    script: Vec<ScriptPart>,
    run_in: RunIn,
    #[serde(default)]
    custom_path: Option<String>,
    #[serde(default)]
    output_as: Option<OutputAs>,
}

pub struct RunCommandAction;

impl Action for RunCommandAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: "run_command",
            title: "Run command",
            group: ActionGroup::Builtin,
            auth: ActionAuth::None,
            credential_label_hint: None,
            params_schema: params_schema(),
            outputs: vec![
                ActionOutput::new("output", ActionOutputType::Text),
                ActionOutput::new("exitCode", ActionOutputType::Number),
            ],
            idempotent: false,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> crate::engine::BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            let input: RunCommandInput = parse_input("run_command", params)?;
            if input.script.is_empty() {
                return Err(ActionError(
                    "invalid input for 'run_command': script must not be empty".to_string(),
                ));
            }
            let cwd = resolve_cwd(ctx, input.run_in, input.custom_path.as_deref()).await?;
            let (script, env) = compile_script(&input.script);
            let shell = resolve_shell().await;
            let (exit_code, stdout, stderr) = spawn_script(&shell, &script, &cwd, &env).await?;
            if exit_code != 0 {
                let tail = tail_chars(stderr.trim(), STDERR_TAIL_CHARS);
                let detail = if tail.is_empty() {
                    "(no stderr output)"
                } else {
                    tail
                };
                return Err(ActionError(format!(
                    "run_command exited {exit_code}: {detail}"
                )));
            }
            let mut outputs = ActionOutputs::new();
            outputs.insert(
                "output".to_string(),
                format_output(&stdout, input.output_as),
            );
            outputs.insert("exitCode".to_string(), TokenValue::Number(exit_code as f64));
            Ok(outputs)
        })
    }
}

/// Each chip becomes its own quoted `"$MF_<n>"` placeholder — the value
/// never becomes shell text.
pub(crate) fn compile_script(parts: &[ScriptPart]) -> (String, Vec<(String, String)>) {
    let mut script = String::new();
    let mut env = Vec::new();
    for part in parts {
        match part {
            ScriptPart::Literal(p) => script.push_str(&p.literal),
            ScriptPart::Chip(p) => {
                let name = format!("MF_{}", env.len());
                script.push_str(&format!("\"${name}\""));
                env.push((name, p.chip.clone()));
            }
        }
    }
    (script, env)
}

/// cwd is never shell source — `custom` is the only mode that runs
/// user-authored text, through realpath containment (A1).
async fn resolve_cwd(
    ctx: &ActionCtx,
    run_in: RunIn,
    custom_path: Option<&str>,
) -> Result<String, ActionError> {
    match run_in {
        RunIn::ProjectRoot => Ok(ctx.project_root.clone()),
        RunIn::Worktree => ctx.worktree_path.clone().ok_or_else(|| {
            ActionError(
                "run_command runIn \"worktree\" requested but no worktree is active for this run"
                    .to_string(),
            )
        }),
        RunIn::Custom => {
            let requested = custom_path.ok_or_else(|| {
                ActionError("run_command runIn 'custom' requires customPath".to_string())
            })?;
            resolve_and_validate_path(&ctx.project_root, requested)
                .await
                .ok_or_else(|| {
                    ActionError(format!(
                        "run_command custom cwd '{requested}' is outside the project root"
                    ))
                })
        }
    }
}

async fn resolve_shell() -> String {
    match tokio::fs::try_exists("/bin/zsh").await {
        Ok(true) => "/bin/zsh".to_string(),
        _ => "/bin/sh".to_string(),
    }
}

async fn spawn_script(
    shell: &str,
    script: &str,
    cwd: &str,
    env: &[(String, String)],
) -> Result<(i32, String, String), ActionError> {
    let mut child = Command::new(shell)
        .arg("-lc")
        .arg(script)
        .current_dir(cwd)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| ActionError(format!("run_command failed to spawn {shell}: {err}")))?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let (out, err) = tokio::join!(read_capped(stdout_pipe), read_capped(stderr_pipe));
    let (stdout, out_exceeded) = out.map_err(io_error)?;
    let (stderr, err_exceeded) = err.map_err(io_error)?;

    if out_exceeded || err_exceeded {
        // Node parity: execFile kills the child when maxBuffer is exceeded.
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(ActionError(format!(
            "run_command output exceeded {MAX_OUTPUT_BYTES} bytes; write large data to a file instead"
        )));
    }

    let status = child.wait().await.map_err(io_error)?;
    let exit_code = status.code().ok_or_else(|| {
        ActionError("run_command terminated by a signal before producing an exit code".to_string())
    })?;
    Ok((
        exit_code,
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
    ))
}

async fn read_capped<R: AsyncRead + Unpin>(reader: Option<R>) -> std::io::Result<(Vec<u8>, bool)> {
    let Some(mut reader) = reader else {
        return Ok((Vec::new(), false));
    };
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            return Ok((buf, false));
        }
        if buf.len() + n > MAX_OUTPUT_BYTES {
            return Ok((buf, true));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

fn format_output(stdout: &str, output_as: Option<OutputAs>) -> TokenValue {
    let trimmed = stdout.trim();
    match output_as {
        Some(OutputAs::Lines) => TokenValue::List(
            trimmed
                .split('\n')
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| TokenValue::Text(line.to_string()))
                .collect(),
        ),
        _ => TokenValue::Text(trimmed.to_string()),
    }
}

fn tail_chars(s: &str, n: usize) -> &str {
    let count = s.chars().count();
    if count <= n {
        return s;
    }
    s.char_indices()
        .nth(count - n)
        .map(|(idx, _)| &s[idx..])
        .unwrap_or(s)
}

fn io_error(err: std::io::Error) -> ActionError {
    ActionError(format!("run_command I/O failed: {err}"))
}

fn params_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "script": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "anyOf": [
                        {
                            "type": "object",
                            "properties": {"literal": {"type": "string"}},
                            "required": ["literal"],
                            "additionalProperties": false
                        },
                        {
                            "type": "object",
                            "properties": {"chip": {"type": "string"}},
                            "required": ["chip"],
                            "additionalProperties": false
                        }
                    ]
                }
            },
            "runIn": {"type": "string", "enum": ["project root", "worktree", "custom"]},
            "customPath": {"type": "string"},
            "outputAs": {"type": "string", "enum": ["text", "lines"]}
        },
        "required": ["script", "runIn"],
        "additionalProperties": false
    })
}

#[cfg(test)]
pub(crate) async fn resolve_cwd_for_test(
    ctx: &ActionCtx,
    run_in: &str,
    custom_path: Option<&str>,
) -> Result<String, ActionError> {
    let run_in: RunIn = serde_json::from_value(Value::String(run_in.to_string()))
        .map_err(|err| ActionError(err.to_string()))?;
    resolve_cwd(ctx, run_in, custom_path).await
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.3), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node actions/run-command.ts (compileScript/resolveCwd/
//        spawnScript/formatOutput); 8 MB cap = Node's execFile maxBuffer,
//        enforced by capped stream reads + kill instead of maxBuffer.
