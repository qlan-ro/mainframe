//! Golden round-trip harness over every fixture in
//! `tests/fixtures/acp/` — the vendored ACP v2 chat-facade grammar (todo
//! #350, plan task 1/2). Mirrors `golden_fixtures.rs`'s pattern: dispatch each
//! fixture file to its `mainframe_types::acp` type by filename prefix,
//! deserialize, re-serialize, and assert semantic equality after stripping
//! the fixture-only `_provenance` key. Failures aggregate across all
//! fixtures so one drifting file doesn't hide another (see
//! `golden_fixtures.rs` module docs for the same rationale).

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use mainframe_types::acp::extensions::{
    CompactionParams, GateResolvedParams, HeartbeatParams, ItemMeta, MainframeCapabilities,
    PromptSendMeta, QueuedPromptState, RetryMarker, RichPermissionAnswer, StructuredDiff,
    TranscriptClearedParams, TruncationMarker, UsageMeta,
};
use mainframe_types::acp::jsonrpc::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
use mainframe_types::acp::permission::{RequestPermissionRequest, RequestPermissionResponse};
use mainframe_types::acp::session::{
    CancelSessionNotification, InitializeRequest, InitializeResponse, NewSessionRequest,
    NewSessionResponse, PromptRequest, PromptResponse, ResumeSessionRequest, ResumeSessionResponse,
};
use mainframe_types::acp::update::UpdateSessionNotification;

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/acp")
        .canonicalize()
        .expect("acp fixtures directory must exist")
}

fn strip_provenance(mut v: Value) -> Value {
    if let Some(obj) = v.as_object_mut() {
        obj.remove("_provenance");
    }
    v
}

/// Canonicalize every JSON number to `f64` — see `golden_fixtures.rs` for why
/// (an integer-literal fixture value must compare equal to a whole-valued
/// float the Rust side serializes, e.g. `UsageUpdate.cost.amount`).
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => n.as_f64().map(|f| json!(f)).unwrap_or_else(|| v.clone()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, val)| (k.clone(), norm(val))).collect())
        }
        _ => v.clone(),
    }
}

fn roundtrip_as<T>(v: &Value) -> Result<(), String>
where
    T: DeserializeOwned + Serialize,
{
    let parsed: T =
        serde_json::from_value(v.clone()).map_err(|e| format!("deserialize failed: {e}"))?;
    let back = serde_json::to_value(&parsed).map_err(|e| format!("serialize failed: {e}"))?;
    if norm(v) != norm(&back) {
        return Err(format!(
            "round-trip mismatch:\n    in:  {v}\n    out: {back}"
        ));
    }
    Ok(())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}

fn read_fixture(path: &Path) -> Value {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("read {path:?}: {e}"))
        .unwrap();
    serde_json::from_str(&raw)
        .map_err(|e| format!("parse {path:?}: {e}"))
        .unwrap()
}

/// Filename prefix → vendored type. One arm per frame kind from plan task 1;
/// order matters where one prefix is a substring of another (`session-new.`
/// vs `session-update.`), so longer/more-specific prefixes are checked first.
fn roundtrip_by_name(name: &str, body: &Value) -> Result<(), String> {
    if name == "transcript-cleared.notification.json" {
        return roundtrip_as::<JsonRpcNotification>(body);
    }
    if name == "transcript-cleared.params.json" {
        return roundtrip_as::<TranscriptClearedParams>(body);
    }
    if name == "compaction.notification.json" {
        return roundtrip_as::<JsonRpcNotification>(body);
    }
    if name == "compaction.params.json" {
        return roundtrip_as::<CompactionParams>(body);
    }
    if name == "heartbeat.notification.json" {
        return roundtrip_as::<JsonRpcNotification>(body);
    }
    if name == "heartbeat.params.json" {
        return roundtrip_as::<HeartbeatParams>(body);
    }
    if name == "gate-resolved.notification.json" {
        return roundtrip_as::<JsonRpcNotification>(body);
    }
    if name == "gate-resolved.params.json" {
        return roundtrip_as::<GateResolvedParams>(body);
    }
    if name.starts_with("extensions.capabilities") {
        return roundtrip_as::<MainframeCapabilities>(body);
    }
    if name.starts_with("extensions.usage-meta") {
        return roundtrip_as::<UsageMeta>(body);
    }
    if name.starts_with("extensions.retry-marker") {
        return roundtrip_as::<RetryMarker>(body);
    }
    if name.starts_with("extensions.item-meta") {
        return roundtrip_as::<ItemMeta>(body);
    }
    if name.starts_with("extensions.prompt-send-meta") {
        return roundtrip_as::<PromptSendMeta>(body);
    }
    if name.starts_with("extensions.queued-state") {
        return roundtrip_as::<QueuedPromptState>(body);
    }
    if name.starts_with("extensions.rich-permission-answer") {
        return roundtrip_as::<RichPermissionAnswer>(body);
    }
    if name.starts_with("extensions.structured-diff") {
        return roundtrip_as::<StructuredDiff>(body);
    }
    if name.starts_with("extensions.truncation-marker") {
        return roundtrip_as::<TruncationMarker>(body);
    }
    if name.starts_with("jsonrpc-request.") {
        return roundtrip_as::<JsonRpcRequest>(body);
    }
    if name.starts_with("jsonrpc-response.") {
        return roundtrip_as::<JsonRpcResponse>(body);
    }
    if name.starts_with("jsonrpc-notification.") {
        return roundtrip_as::<JsonRpcNotification>(body);
    }
    if name.starts_with("initialize.request") {
        return roundtrip_as::<InitializeRequest>(body);
    }
    if name.starts_with("initialize.response") {
        return roundtrip_as::<InitializeResponse>(body);
    }
    if name.starts_with("session-new.request") {
        return roundtrip_as::<NewSessionRequest>(body);
    }
    if name.starts_with("session-new.response") {
        return roundtrip_as::<NewSessionResponse>(body);
    }
    if name.starts_with("session-prompt.request") {
        return roundtrip_as::<PromptRequest>(body);
    }
    if name.starts_with("session-prompt.response") {
        return roundtrip_as::<PromptResponse>(body);
    }
    if name.starts_with("session-cancel.notification") {
        return roundtrip_as::<CancelSessionNotification>(body);
    }
    if name.starts_with("session-resume.request") {
        return roundtrip_as::<ResumeSessionRequest>(body);
    }
    if name.starts_with("session-resume.response") {
        return roundtrip_as::<ResumeSessionResponse>(body);
    }
    if name.starts_with("session-update.") {
        return roundtrip_as::<UpdateSessionNotification>(body);
    }
    if name.starts_with("permission.request") {
        return roundtrip_as::<RequestPermissionRequest>(body);
    }
    if name.starts_with("permission.response") {
        return roundtrip_as::<RequestPermissionResponse>(body);
    }
    Err(format!(
        "{name}: no dispatch arm — add one in acp_golden_fixtures.rs"
    ))
}

#[test]
fn every_acp_fixture_round_trips() {
    let dir = fixtures_dir();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("read acp fixtures dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no acp/*.json fixtures found");

    let mut failures: Vec<String> = Vec::new();
    for path in &files {
        let name = file_name(path);
        let body = strip_provenance(read_fixture(path));
        if let Err(reason) = roundtrip_by_name(&name, &body) {
            failures.push(format!("{name}: {reason}"));
        }
    }

    assert!(
        failures.is_empty(),
        "{} acp fixture(s) drifted (of {} checked):\n\n{}",
        failures.len(),
        files.len(),
        failures.join("\n\n")
    );
}
