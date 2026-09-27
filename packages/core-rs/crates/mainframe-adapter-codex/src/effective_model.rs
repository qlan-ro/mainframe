use std::{path::Path, time::Duration};

use serde_json::json;

use crate::jsonrpc::{JsonRpcClient, JsonRpcError};
use crate::session::spawn_temp_app_server;
use crate::turn_model::non_empty;

async fn resolve(client: &JsonRpcClient, cwd: &str) -> Result<Option<String>, JsonRpcError> {
    let config = client
        .request(
            "config/read",
            Some(json!({"cwd": cwd, "includeLayers": false})),
        )
        .await?;
    if let Some(model) = non_empty(config["config"]["model"].as_str()) {
        return Ok(Some(model.to_owned()));
    }
    let started = client
        .request(
            "thread/start",
            Some(json!({
                "cwd": cwd,
                "ephemeral": true,
                "experimentalRawEvents": false,
                "persistExtendedHistory": false
            })),
        )
        .await?;
    Ok(non_empty(started["model"].as_str()).map(str::to_owned))
}

pub(crate) async fn probe(executable: &str, path: &str, cwd: &str) -> Option<String> {
    let client = match spawn_temp_app_server(executable, Some(Path::new(cwd)), true, path).await {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(module = "codex:models", %error, "could not start Codex model probe");
            return None;
        }
    };
    let result = tokio::time::timeout(Duration::from_secs(10), resolve(&client, cwd)).await;
    client.close();
    match result {
        Ok(Ok(model)) => model,
        Ok(Err(error)) => {
            tracing::warn!(module = "codex:models", %error, "could not resolve Codex configured model");
            None
        }
        Err(error) => {
            tracing::warn!(module = "codex:models", %error, "Codex configured model probe timed out");
            None
        }
    }
}
