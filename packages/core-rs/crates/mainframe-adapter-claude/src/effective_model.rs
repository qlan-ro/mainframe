use std::{process::Stdio, time::Duration};

use mainframe_adapter_api::AdapterError;
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
};

pub(crate) fn applied_model(response: &Value) -> Option<String> {
    if response.get("subtype")?.as_str()? != "success" {
        return None;
    }
    response
        .get("response")?
        .get("applied")?
        .get("model")?
        .as_str()
        .filter(|model| !model.is_empty())
        .map(str::to_string)
}

pub(crate) async fn required_probe(
    executable: &str,
    path: &str,
    cwd: &str,
) -> Result<String, AdapterError> {
    probe(executable, path, cwd).await.ok_or_else(|| {
        AdapterError::Message("Could not resolve the CLI configured model. Select a model explicitly or check the CLI settings.".into())
    })
}

pub(crate) async fn probe(executable: &str, path: &str, cwd: &str) -> Option<String> {
    let mut child = Command::new(executable)
        .args([
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-prompt-tool",
            "stdio",
            "--no-session-persistence",
        ])
        .current_dir(cwd)
        .env("PATH", path)
        .env_remove("CLAUDECODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let result = tokio::time::timeout(Duration::from_secs(10), query(&mut child))
        .await
        .ok()
        .flatten();
    let _ = child.kill().await;
    result
}

async fn query(child: &mut Child) -> Option<String> {
    let mut stdin = child.stdin.take()?;
    let request = json!({"type": "control_request", "request_id": "effective-model",
        "request": {"subtype": "get_settings"}});
    stdin
        .write_all(format!("{request}\n").as_bytes())
        .await
        .ok()?;
    stdin.flush().await.ok()?;
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if event.get("type").and_then(Value::as_str) != Some("control_response") {
            continue;
        }
        let Some(response) = event.get("response") else {
            continue;
        };
        if response.get("request_id").and_then(Value::as_str) == Some("effective-model") {
            return applied_model(response);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_applied_model_instead_of_catalog_recommendation() {
        assert_eq!(
            applied_model(&json!({"subtype":"success", "response": {
                "applied":{"model":"claude-fable-5-1"},
                "models":[{"value":"default","resolvedModel":"claude-opus-5"}]
            }}))
            .as_deref(),
            Some("claude-fable-5-1")
        );
        assert_eq!(
            applied_model(&json!({"subtype":"error", "error":"unsupported"})),
            None
        );
        assert_eq!(
            applied_model(&json!({"subtype":"success", "response":{}})),
            None
        );
    }
}
