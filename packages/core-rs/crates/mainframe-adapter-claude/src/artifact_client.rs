//! Reads claude.ai artifacts through `claude mcp serve`.
//!
//! The CLI's MCP server exposes its `Artifact` tool without a model, so these calls
//! cost no tokens and use the CLI's own login: Mainframe never sees a credential.
//! Only the read-only `list` and `read` actions are reachable from here, because
//! no permission prompt guards tool calls made this way.
//!
//! Artifacts are off by default for this entrypoint, so the flag goes on this child
//! only and chat sessions keep their default.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use mainframe_adapter_api::AdapterError;
use mainframe_runtime::ResolvedPath;
use mainframe_runtime::process::cli_command;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};

const ARTIFACT_TOOL: &str = "Artifact";
const PROTOCOL_VERSION: &str = "2025-06-18";
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize)]
pub struct ArtifactFile {
    pub path: String,
    #[serde(default)]
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
pub struct ArtifactListing {
    #[serde(rename = "ver")]
    pub version: String,
    #[serde(default)]
    pub from_type: bool,
    pub files: Vec<ArtifactFile>,
}

#[derive(Debug, Deserialize)]
pub struct SavedFile {
    pub path: String,
    pub saved_to: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct SavedArtifact {
    #[serde(default)]
    pub title: Option<String>,
    pub saved_dir: PathBuf,
    pub files: Vec<SavedFile>,
}

pub struct ArtifactClient {
    // Held so `kill_on_drop` ends the server with this client.
    _child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

fn protocol_error(message: impl Into<String>) -> AdapterError {
    AdapterError::Message(message.into())
}

/// The JSON a tool returned as its text content.
fn tool_payload(response: &Value) -> Result<Value, AdapterError> {
    if let Some(error) = response.get("error") {
        return Err(protocol_error(format!("artifact call failed: {error}")));
    }
    let result = &response["result"];
    let text = result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|part| part["text"].as_str())
        .collect::<String>();
    if result["isError"].as_bool() == Some(true) {
        return Err(protocol_error(format!("artifact tool error: {text}")));
    }
    Ok(serde_json::from_str(&text)?)
}

fn parse_listing(payload: Value) -> Result<ArtifactListing, AdapterError> {
    Ok(serde_json::from_value(payload["file_list"].clone())?)
}

fn parse_saved(payload: Value) -> Result<SavedArtifact, AdapterError> {
    Ok(serde_json::from_value(payload["files_read"].clone())?)
}

impl ArtifactClient {
    /// Starts the server in `cwd`; the CLI saves read files in a scratch folder keyed by it.
    pub async fn start(
        binary: &str,
        path: &ResolvedPath,
        cwd: &Path,
    ) -> Result<Self, AdapterError> {
        let mut command = cli_command(binary, path);
        command
            .args(["mcp", "serve"])
            .current_dir(cwd)
            .env("CLAUDE_CODE_ARTIFACT", "1")
            .env_remove("CLAUDECODE")
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|source| AdapterError::Spawn {
            what: "artifact server",
            binary: binary.to_string(),
            source,
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| protocol_error("artifact server has no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| protocol_error("artifact server has no stdout"))?;
        let mut client = Self {
            _child: child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            next_id: 0,
        };
        client.initialize().await?;
        Ok(client)
    }

    async fn initialize(&mut self) -> Result<(), AdapterError> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "mainframe", "version": env!("CARGO_PKG_VERSION") },
        });
        self.request("initialize", params).await?;
        self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await
    }

    async fn send(&mut self, message: &Value) -> Result<(), AdapterError> {
        let mut line = serde_json::to_vec(message)?;
        line.push(b'\n');
        self.stdin.write_all(&line).await?;
        Ok(self.stdin.flush().await?)
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, AdapterError> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        tokio::time::timeout(CALL_TIMEOUT, self.response(id))
            .await
            .map_err(|_| AdapterError::Timeout("artifact call timed out"))?
    }

    /// Skips the notifications and non-JSON lines a server may write between replies.
    async fn response(&mut self, id: u64) -> Result<Value, AdapterError> {
        while let Some(line) = self.lines.next_line().await? {
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if message["id"].as_u64() == Some(id) {
                return Ok(message);
            }
        }
        Err(protocol_error("artifact server exited"))
    }

    async fn call(&mut self, arguments: Value) -> Result<Value, AdapterError> {
        let params = json!({ "name": ARTIFACT_TOOL, "arguments": arguments });
        tool_payload(&self.request("tools/call", params).await?)
    }

    pub async fn list(&mut self, url: &str) -> Result<ArtifactListing, AdapterError> {
        parse_listing(
            self.call(json!({ "action": "list", "url": url, "scope": "files" }))
                .await?,
        )
    }

    /// Saves `paths` to the CLI's scratch folder and reports where each landed.
    pub async fn read(
        &mut self,
        url: &str,
        paths: &[String],
    ) -> Result<SavedArtifact, AdapterError> {
        parse_saved(
            self.call(json!({ "action": "read", "url": url, "paths": paths }))
                .await?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_response(text: &str) -> Value {
        json!({ "id": 1, "result": { "content": [{ "type": "text", "text": text }] } })
    }

    #[test]
    fn reads_a_file_listing() {
        let text = r#"{"file_list":{"url":"u","ver":"179-0618","from_type":true,"files":[
            {"path":"project/canvas.json","content_type":"application/json","size_bytes":361,"sha256":"a"}]}}"#;
        let listing =
            parse_listing(tool_payload(&tool_response(text)).expect("payload")).expect("listing");
        assert_eq!(listing.version, "179-0618");
        assert!(listing.from_type);
        assert_eq!(listing.files[0].path, "project/canvas.json");
        assert_eq!(listing.files[0].size_bytes, 361);
    }

    #[test]
    fn an_untyped_artifact_lists_no_type_and_no_files() {
        let text = r#"{"file_list":{"ver":"1","files":[]}}"#;
        let listing =
            parse_listing(tool_payload(&tool_response(text)).expect("payload")).expect("listing");
        assert!(!listing.from_type);
        assert!(listing.files.is_empty());
    }

    #[test]
    fn reads_where_files_were_saved() {
        let text = r#"{"files_read":{"url":"u","title":"Coffee","ver":"1","saved_dir":"/tmp/a",
            "files":[{"path":"project/Main.dc.html","saved_to":"/tmp/a/project/Main.dc.html"}]}}"#;
        let saved =
            parse_saved(tool_payload(&tool_response(text)).expect("payload")).expect("saved");
        assert_eq!(saved.title.as_deref(), Some("Coffee"));
        assert_eq!(saved.saved_dir, PathBuf::from("/tmp/a"));
        assert_eq!(
            saved.files[0].saved_to,
            PathBuf::from("/tmp/a/project/Main.dc.html")
        );
    }

    #[test]
    fn a_tool_error_is_reported_with_its_text() {
        let response = json!({ "id": 1, "result": {
            "isError": true, "content": [{ "type": "text", "text": "No Artifact at that url" }] } });
        let error = tool_payload(&response).expect_err("tool error");
        assert!(error.to_string().contains("No Artifact at that url"));
    }

    #[test]
    fn a_protocol_error_is_reported() {
        let response = json!({ "id": 1, "error": { "code": -32601, "message": "nope" } });
        assert!(tool_payload(&response).is_err());
    }

    #[test]
    fn a_non_json_reply_is_an_error_not_a_panic() {
        assert!(tool_payload(&tool_response("Sign in to continue")).is_err());
    }
}
