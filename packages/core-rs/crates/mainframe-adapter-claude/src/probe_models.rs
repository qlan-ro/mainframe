//! Ported from `packages/core/src/plugins/builtin/claude/probe-models.ts`.

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
        // Drop the "with 1M context" tail for default — "Default" already implies top config.
        let bare = identity
            .as_deref()
            .map(strip_with_tail)
            .filter(|b| !b.is_empty());
        match bare {
            Some(b) => format!("Default - {b}"),
            None => "Default".to_string(),
        }
    } else if let Some(id) = identity.as_deref() {
        id.to_string()
    } else {
        display_name.to_string()
    };

    let mut model = AdapterModel {
        id: value.to_string(),
        label,
        description: None,
        context_window: None,
        is_default: None,
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
    let models = raw_models.iter().map(map_model_info).collect();
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
mod tests {
    use super::*;
    use serde_json::json;

    fn model(id: &str, label: &str) -> AdapterModel {
        AdapterModel {
            id: id.to_string(),
            label: label.to_string(),
            description: None,
            context_window: None,
            is_default: None,
            supported_efforts: None,
            default_effort: None,
            supports_fast: None,
            supports_ultracode: None,
            supports_adaptive_thinking: None,
            supports_personality: None,
        }
    }

    #[test]
    fn extract_probe_payload_reads_models_and_default_resolved_model() {
        let event = json!({
            "type": "control_response",
            "response": { "response": {
                "models": [{ "value": "default", "displayName": "Default", "resolvedModel": "claude-fable-5[1m]" }]
            }}
        });
        let out = extract_probe_payload(&event).unwrap();
        assert_eq!(out.models.len(), 1);
        assert_eq!(out.resolved_model.as_deref(), Some("claude-fable-5[1m]"));
    }

    #[test]
    fn extract_probe_payload_returns_none_without_models_array() {
        let event = json!({ "type": "control_response", "response": { "response": {} } });
        assert!(extract_probe_payload(&event).is_none());
    }

    #[test]
    fn extract_probe_payload_undefined_resolved_when_no_default() {
        let event = json!({
            "type": "control_response",
            "response": { "response": { "models": [{ "value": "claude-sonnet-5", "displayName": "Sonnet 5" }] } }
        });
        assert_eq!(extract_probe_payload(&event).unwrap().resolved_model, None);
    }

    // Ports the parse assertions of claude-probe-models.test.ts's "sends initialize
    // request and parses model response" (the subprocess mock harness itself needs a
    // process abstraction not present here; the parse path is what those assertions check).
    #[test]
    fn extract_probe_payload_maps_full_initialize_response() {
        let event = json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": "test", "response": {
                "commands": [], "agents": [], "output_style": "concise",
                "available_output_styles": ["concise"],
                "models": [
                    {
                        "value": "default",
                        "displayName": "Default (recommended)",
                        "description": "Opus 4.7 with 1M context",
                        "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
                        "supportsFastMode": true,
                        "supportsAdaptiveThinking": true
                    },
                    { "value": "claude-sonnet-4-6", "displayName": "Sonnet", "description": "Sonnet 4.6 · Best for everyday tasks" }
                ],
                "account": {}, "pid": 12345
            }}
        });
        let out = extract_probe_payload(&event).unwrap();
        assert_eq!(out.models.len(), 2);

        let mut expected0 = model("default", "Default - Opus 4.7");
        expected0.description = Some("Opus 4.7 with 1M context".to_string());
        expected0.supported_efforts = Some(vec![
            EffortLevel::Low,
            EffortLevel::Medium,
            EffortLevel::High,
            EffortLevel::Xhigh,
            EffortLevel::Max,
        ]);
        expected0.supports_fast = Some(true);
        expected0.supports_adaptive_thinking = Some(true);
        expected0.supports_ultracode = Some(true);
        expected0.is_default = Some(true);
        assert_eq!(out.models[0], expected0);

        let mut expected1 = model("claude-sonnet-4-6", "Sonnet 4.6");
        expected1.description = Some("Sonnet 4.6 · Best for everyday tasks".to_string());
        assert_eq!(out.models[1], expected1);
    }

    #[test]
    fn map_model_info_maps_efforts_fast_adaptive_derives_ultracode() {
        let m = map_model_info(&json!({
            "value": "default",
            "displayName": "Default",
            "description": "Opus 4.8 with 1M context · Most capable",
            "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
            "supportsAdaptiveThinking": true,
            "supportsFastMode": true
        }));
        assert_eq!(
            m.supported_efforts,
            Some(vec![
                EffortLevel::Low,
                EffortLevel::Medium,
                EffortLevel::High,
                EffortLevel::Xhigh,
                EffortLevel::Max,
            ])
        );
        assert_eq!(m.supports_fast, Some(true));
        assert_eq!(m.supports_adaptive_thinking, Some(true));
        assert_eq!(m.supports_ultracode, Some(true)); // derived from xhigh
    }

    #[test]
    fn map_model_info_hides_ultracode_without_xhigh() {
        let m = map_model_info(&json!({
            "value": "sonnet",
            "displayName": "Sonnet",
            "description": "Sonnet 4.6",
            "supportedEffortLevels": ["low", "medium", "high", "max"],
            "supportsFastMode": true
        }));
        assert_eq!(m.supports_ultracode, None);
    }
}

// PORT STATUS: src/plugins/builtin/claude/probe-models.ts (160 lines)
// confidence: medium
// todos: 0
// notes: pure `map_model_info`/`extract_probe_payload` ported faithfully (JS dynamic
// notes: property access mirrored via serde_json::Value getters, so an unknown effort
// notes: string is skipped rather than erroring). `probe_models()` spawns via
// notes: tokio::process (kill_on_drop = detached:false); request_id uses nanoid rather
// notes: than crypto.randomUUID (opaque — probe never correlates by id). Its
// notes: subprocess-mock tests (spawn error / timeout / initialize write) need a
// notes: process abstraction not available here; the parse assertions they cover are
// notes: ported against extract_probe_payload instead.
