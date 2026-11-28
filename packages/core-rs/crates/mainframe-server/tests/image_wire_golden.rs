//! Golden test: what clients receive for a chat with images is byte-for-byte
//! fixed. Guards the in-memory representation of image payloads and the
//! display projector's internals, which may change how the daemon holds a
//! chat but never what it sends.
//!
//! A synthetic Claude transcript with prompt images, tool-result images and a
//! repeated image goes through the real cold-load parser, then the
//! incremental projector one append at a time (each preceded by a streaming
//! overlay of the next message), the encoder, the live diff engine, the
//! revision log, `session/resume`, and history pages in every delivery form
//! (plain, lazy image references, compressed batches, binary frames). Each
//! output's SHA-256 and length must match `fixtures/image_wire.golden.json`.
//!
//! The golden was captured from the code before images were shared, so a
//! match proves the representation change is invisible on the wire. To
//! re-capture (only for an intended wire change), run with
//! `IMAGE_WIRE_GOLDEN_UPDATE=1`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    reason = "Test assertions and scenarios"
)]

#[path = "image_wire/transcript.rs"]
mod transcript;

use std::collections::BTreeMap;

use mainframe_acp::history_page::{self, PageOptions};
use mainframe_acp::{
    ReplayPlan, ResumePort, RevisionLog, SessionState, binary_frame, dispatch_resume, encode,
};
use mainframe_display::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput, RawChanges};
use mainframe_types::BoxFuture;
use mainframe_types::acp::extensions::HistoryPageParams;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, RequestId};
use mainframe_types::display::DisplayMessage;
use mainframe_types::resume::ResumeSnapshot;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use transcript::{CHAT_ID, PROJECT_PATH, appended, load_raw};

struct Port(Vec<DisplayMessage>);

impl ResumePort for Port {
    fn resume_snapshot<'a>(&'a self, _session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot> {
        Box::pin(async move {
            ResumeSnapshot {
                messages: self.0.clone(),
                streaming: None,
                pending: None,
            }
        })
    }

    fn is_running(&self, _session_id: &str) -> bool {
        false
    }
}

fn resume_request(replay_from: Option<Value>) -> JsonRpcRequest {
    let mut params = json!({ "sessionId": CHAT_ID, "cwd": PROJECT_PATH });
    if let Some(cursor) = replay_from {
        params["replayFrom"] = cursor;
    }
    JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(RequestId::Number(7)),
        method: "session/resume".to_string(),
        params: Some(params),
    }
}

fn json_bytes(value: &impl serde::Serialize) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

/// Every client-visible output for the synthetic chat, by name.
async fn wire_outputs() -> BTreeMap<String, Vec<u8>> {
    let raw = load_raw().await;
    let mut out = BTreeMap::new();
    // The history snapshot and tail caches persist `Vec<ChatMessage>` as JSON.
    out.insert("raw_cache_json".to_string(), json_bytes(&raw));

    let mut projector = IncrementalProjector::new();
    let mut state = SessionState::new();
    let mut log = RevisionLog::new("epoch-golden".to_string());
    let mut deltas = Vec::new();
    let mut live = Vec::new();
    let mut cursors = Vec::new();
    let mut display = Vec::new();
    for end in 1..=raw.len() {
        let overlays = [raw.get(end).cloned(), None];
        for overlay in overlays {
            let changes = if overlay.is_some() {
                RawChanges::default()
            } else {
                appended()
            };
            let delta = projector.project(ProjectionInput {
                raw: &raw[..end],
                overlay: overlay.as_ref(),
                categories: None,
                changes,
            });
            display = delta.snapshot.materialize();
            deltas.push(json!({
                "full": delta.full,
                "len": delta.len,
                "changes": delta.changes,
            }));
            let items = encode(&display);
            live.push(state.diff(&items));
            log.record(&items);
            cursors.push(log.boundary());
        }
    }
    out.insert("projector_deltas".to_string(), json_bytes(&deltas));
    out.insert("display_snapshot".to_string(), json_bytes(&display));
    out.insert("live_updates".to_string(), json_bytes(&live));
    let items = encode(&display);
    out.insert("encoded_items".to_string(), json_bytes(&items));

    let plans: Vec<Value> = cursors
        .iter()
        .step_by(3)
        .map(|cursor| match log.plan(cursor, &items) {
            ReplayPlan::Full => json!("full"),
            ReplayPlan::Incremental(updates) => json!(updates),
        })
        .collect();
    out.insert("revision_plans".to_string(), json_bytes(&plans));

    let port = Port(display.clone());
    for (name, cursor) in [
        ("resume_no_cursor", None),
        ("resume_start", Some(json!({ "type": "start" }))),
    ] {
        let (response, replay) = dispatch_resume(resume_request(cursor), &port, None).await;
        out.insert(
            name.to_string(),
            json_bytes(&json!({ "response": response, "updates": replay.updates })),
        );
    }

    let last = items.last().unwrap().id().to_string();
    let params = HistoryPageParams {
        session_id: CHAT_ID.to_string(),
        before: last,
        containers: Some(50),
        items: None,
        turns: None,
        until_item_id: None,
    };
    let forms = [
        ("page_plain", PageOptions::default()),
        (
            "page_lazy_images",
            PageOptions {
                lazy_tool_images: true,
                ..PageOptions::default()
            },
        ),
        (
            "page_previews",
            PageOptions {
                previews: true,
                ..PageOptions::default()
            },
        ),
        (
            "page_compressed",
            PageOptions {
                compressed: true,
                ..PageOptions::default()
            },
        ),
        (
            "page_binary_lazy",
            PageOptions {
                binary: true,
                lazy_tool_images: true,
                ..PageOptions::default()
            },
        ),
        (
            "page_binary",
            PageOptions {
                binary: true,
                ..PageOptions::default()
            },
        ),
    ];
    for (name, options) in forms {
        let page = history_page::prepare(&display, &params, options);
        let total = page.result.frames.len();
        let frames: Vec<Vec<u8>> = page
            .result
            .frames
            .iter()
            .enumerate()
            .map(|(index, frame)| binary_frame::encode_frame("7", index, total, frame).unwrap())
            .collect();
        out.insert(
            name.to_string(),
            json_bytes(&json!({ "result": page.result, "frames": frames })),
        );
    }
    out
}

fn digest(bytes: &[u8]) -> Value {
    let hash = Sha256::digest(bytes);
    let hex: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    json!({ "bytes": bytes.len(), "sha256": hex })
}

#[tokio::test]
async fn client_visible_output_for_a_chat_with_images_is_unchanged() {
    let outputs = wire_outputs().await;
    let actual: BTreeMap<String, Value> = outputs
        .iter()
        .map(|(name, bytes)| (name.clone(), digest(bytes)))
        .collect();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/image_wire.golden.json");
    if std::env::var_os("IMAGE_WIRE_GOLDEN_UPDATE").is_some() {
        std::fs::write(&path, serde_json::to_vec_pretty(&actual).unwrap()).unwrap();
        return;
    }
    let expected: BTreeMap<String, Value> =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    // Sanity: the outputs really carry the images, so the digests cover them.
    assert!(outputs["encoded_items"].len() > 700_000);
    assert!(outputs["page_plain"].len() > 700_000);
    assert!(outputs["page_lazy_images"].len() < outputs["page_plain"].len());
    assert_eq!(
        actual.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>()
    );
    for (name, digest) in &expected {
        assert_eq!(&actual[name], digest, "{name} changed on the wire");
    }
}
