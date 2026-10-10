use std::process::Stdio;
use std::time::Duration;

use mainframe_types::adapter::{AdapterModel, EffortLevel};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const PROBE_TIMEOUT_MS: u64 = 10_000;

/// CLI descriptions look like "Opus 4.7 with 1M context · Most capable for complex work".
/// The part before "·" is the model identity ("Opus 4.7 with 1M context"); the tail is marketing.
fn extract_identity(description: Option<&str>) -> Option<String> {
    let desc = description?;
    let first_chunk = desc.split('·').next()?.trim();
    if first_chunk.is_empty() {
        None
    } else {
        Some(first_chunk.to_string())
    }
}

/// `identity.split(/\s+with\s+/i)[0].trim()` — the part before the first
/// whitespace-delimited, case-insensitive "with".
fn strip_with_tail(identity: &str) -> String {
    let chars: Vec<char> = identity.chars().collect();
    let n = chars.len();
    let mut i = 0;
    while i < n {
        if chars[i].is_whitespace() {
            let ws_start = i;
            while i < n && chars[i].is_whitespace() {
                i += 1;
            }
            if i + 4 <= n
                && chars[i..i + 4]
                    .iter()
                    .collect::<String>()
                    .eq_ignore_ascii_case("with")
                && i + 4 < n
                && chars[i + 4].is_whitespace()
            {
                return chars[..ws_start]
                    .iter()
                    .collect::<String>()
                    .trim()
                    .to_string();
            }
        } else {
            i += 1;
        }
    }
    identity.trim().to_string()
}

/// Reads the raw CLI model entry (`CliModelInfo`) from JSON exactly like the TS
/// property access (undefined-tolerant), producing an `AdapterModel`.
pub fn map_model_info(info: &Value) -> AdapterModel {
    let value = info.get("value").and_then(Value::as_str).unwrap_or("");
    let display_name = info
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or("");
    let description = info.get("description").and_then(Value::as_str);
    let identity = extract_identity(description);

    let label = if value == "default" {
        "Use CLI setting".to_string()
    } else {
        identity.unwrap_or_else(|| display_name.to_string())
    };

    let mut model = AdapterModel {
        id: value.to_string(),
        label,
        description: None,
        resolved_model: None,
        context_window: None,
        is_default: None,
        is_older: None,
        group: None,
        supported_efforts: None,
        default_effort: None,
        supports_fast: None,
        supports_ultracode: None,
        supports_adaptive_thinking: None,
        supports_personality: None,
    };
    if let Some(d) = description {
        model.description = Some(d.to_string());
    }
    if let Some(rm) = info.get("resolvedModel").and_then(Value::as_str) {
        model.resolved_model = Some(rm.to_string());
    }
    let raw_efforts: Vec<&str> = info
        .get("supportedEffortLevels")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !raw_efforts.is_empty() {
        model.supported_efforts =
            Some(raw_efforts.iter().filter_map(|s| parse_effort(s)).collect());
        if raw_efforts.contains(&"xhigh") {
            model.supports_ultracode = Some(true);
        }
    }
    if info.get("supportsFastMode").and_then(Value::as_bool) == Some(true) {
        model.supports_fast = Some(true);
    }
    if info
        .get("supportsAdaptiveThinking")
        .and_then(Value::as_bool)
        == Some(true)
    {
        model.supports_adaptive_thinking = Some(true);
    }
    // The CLI exposes the tier-resolved default under value: "default".
    if value == "default" {
        model.is_default = Some(true);
    }
    model
}

fn parse_effort(s: &str) -> Option<EffortLevel> {
    serde_json::from_value(Value::String(s.to_string())).ok()
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProbeResult {
    pub models: Vec<AdapterModel>,
    pub resolved_model: Option<String>,
}

fn separate_default_selection(mut models: Vec<AdapterModel>) -> Vec<AdapterModel> {
    let Some(default_index) = models.iter().position(|m| m.id == "default") else {
        return models;
    };
    let mut pinned = models[default_index].clone();
    let Some(resolved) = pinned
        .resolved_model
        .as_deref()
        .filter(|id| !id.is_empty() && *id != "default")
        .map(str::to_owned)
    else {
        return models;
    };
    pinned.id = resolved.clone();
    pinned.label = extract_identity(pinned.description.as_deref())
        .map(|identity| strip_with_tail(&identity))
        .unwrap_or_else(|| resolved.clone());
    pinned.is_default = None;
    let mut has_explicit = false;
    for model in &mut models {
        if model.id != "default"
            && (model.id == resolved || model.resolved_model.as_deref() == Some(&resolved))
        {
            has_explicit = true;
            model.label = if model.label.is_empty() {
                pinned.label.clone()
            } else {
                strip_with_tail(&model.label)
            };
        }
    }
    if !has_explicit {
        models.insert(default_index + 1, pinned);
    }
    models
}

/// Parse the (possibly double-wrapped) `initialize` control_response.
///
/// Live-verified against CLI 2.1.198 (2026-07-04): `resolvedModel` is a per-entry
/// field on each model; we only need the "default" entry's, since that's the alias
/// id whose real window `enrichWithContextWindow` must infer.
pub fn extract_probe_payload(event: &Value) -> Option<ProbeResult> {
    if event.get("type").and_then(Value::as_str) != Some("control_response") {
        return None;
    }
    let response = event.get("response");
    let payload = response.and_then(|r| r.get("response")).or(response);
    let raw_models = payload
        .and_then(|p| p.get("models"))
        .and_then(Value::as_array)?;
    let models = separate_default_selection(raw_models.iter().map(map_model_info).collect());
    let resolved_model = raw_models
        .iter()
        .find(|m| m.get("value").and_then(Value::as_str) == Some("default"))
        .and_then(|m| m.get("resolvedModel"))
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    Some(ProbeResult {
        models,
        resolved_model,
    })
}

/// Spawn the CLI in stream-json mode, send an `initialize` control_request, and
/// resolve with the first parsed model catalog (or `None` on error/timeout/exit).
pub async fn probe_models(executable: &str, path: &str) -> Option<ProbeResult> {
    let cwd = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let mut child = match Command::new(executable)
        .args([
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--verbose",
            "--permission-prompt-tool",
            "stdio",
        ])
        .current_dir(cwd)
        .env("PATH", path)
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1")
        .env_remove("CLAUDECODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            tracing::warn!(?err, "probe spawn error");
            return None;
        }
    };

    // Drain stderr so a full pipe never blocks the child (TS: `child.stderr?.resume()`).
    if let Some(mut stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut sink = Vec::new();
            let _ = stderr.read_to_end(&mut sink).await;
        });
    }

    // Keep stdin open for the lifetime of the read loop (dropping it would close
    // the pipe and the CLI could exit before answering).
    let mut stdin = child.stdin.take();
    if let Some(stdin) = stdin.as_mut() {
        let payload = serde_json::json!({
            "type": "control_request",
            "request_id": nanoid::nanoid!(),
            "request": { "subtype": "initialize" },
        });
        let line = format!("{payload}\n");
        let _ = stdin.write_all(line.as_bytes()).await;
        let _ = stdin.flush().await;
    }

    let result = match child.stdout.take() {
        Some(stdout) => {
            let mut lines = BufReader::new(stdout).lines();
            tokio::time::timeout(Duration::from_millis(PROBE_TIMEOUT_MS), async {
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    // expected: CLI emits non-JSON lines (progress indicators, hook events, etc.)
                    if let Ok(event) = serde_json::from_str::<Value>(line)
                        && let Some(parsed) = extract_probe_payload(&event)
                    {
                        tracing::info!(count = parsed.models.len(), "probe received models");
                        return Some(parsed);
                    }
                }
                // CLI exited before sending models — return null.
                None
            })
            .await
        }
        None => Ok(None),
    };

    let _ = child.start_kill();
    match result {
        Ok(inner) => inner,
        Err(_) => {
            tracing::warn!("probe timed out");
            None
        }
    }
}

#[cfg(test)]
mod tests;
