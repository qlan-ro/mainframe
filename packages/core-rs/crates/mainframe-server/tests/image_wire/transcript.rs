//! The synthetic Claude transcript the image wire tests load: prompt images,
//! tool-result images and a repeated image, with deterministic payloads.

use mainframe_adapter_claude::history::load_history;
use mainframe_display::{RawChange, RawChanges};
use mainframe_types::chat::ChatMessage;
use serde_json::{Value, json};

const SESSION_ID: &str = "00000000-0000-4000-8000-00000000aaaa";
pub const CHAT_ID: &str = "chat_images";
pub const PROJECT_PATH: &str = "/tmp/image-wire-project";

/// Deterministic pseudo-random base64 payload of `len` raw bytes.
fn payload(seed: u64, len: usize) -> String {
    let mut state = seed;
    let bytes: Vec<u8> = (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) as u8
        })
        .collect();
    mainframe_types::base64_data::encode(&bytes)
}

fn image(data: &str, media_type: &str) -> Value {
    json!({ "type": "image", "source": { "type": "base64", "media_type": media_type, "data": data } })
}

fn line(kind: &str, uuid: &str, parent: Option<&str>, minute: u32, message: Value) -> String {
    serde_json::to_string(&json!({
        "parentUuid": parent,
        "isSidechain": false,
        "type": kind,
        "message": message,
        "uuid": uuid,
        "timestamp": format!("2026-11-01T10:{minute:02}:00.000Z"),
        "userType": "external",
        "cwd": PROJECT_PATH,
        "sessionId": SESSION_ID,
        "version": "2.1.300",
    }))
    .unwrap()
}

fn assistant(id: &str, content: Value) -> Value {
    json!({ "model": "claude-test", "id": id, "type": "message", "role": "assistant", "content": content })
}

/// Synthetic transcript: a prompt with an image, a screenshot tool returning
/// two images, a `Read` returning one, and a later prompt repeating the first
/// image's bytes.
#[expect(clippy::too_many_lines, reason = "One literal fixture transcript")]
fn transcript() -> String {
    let first = payload(1, 150_000);
    let shot_a = payload(2, 60_000);
    let shot_b = payload(3, 8_000);
    let read = payload(4, 300_000);
    let user = |content: Value| json!({ "role": "user", "content": content });
    [
        line(
            "user",
            "u1",
            None,
            1,
            user(json!([
                { "type": "text", "text": "What is in this screenshot?" },
                image(&first, "image/png"),
            ])),
        ),
        line(
            "assistant",
            "a1",
            Some("u1"),
            2,
            assistant(
                "msg_a",
                json!([{ "type": "text", "text": "Let me take another one." }]),
            ),
        ),
        line(
            "assistant",
            "a2",
            Some("a1"),
            2,
            assistant(
                "msg_a",
                json!([{ "type": "tool_use", "id": "toolu_shot", "name": "mcp__browser__screenshot", "input": { "fullPage": true } }]),
            ),
        ),
        line(
            "user",
            "u2",
            Some("a2"),
            3,
            user(json!([{
                "type": "tool_result",
                "tool_use_id": "toolu_shot",
                "content": [
                    { "type": "text", "text": "captured 2 frames" },
                    image(&shot_a, "image/png"),
                    image(&shot_b, "image/jpeg"),
                ],
            }])),
        ),
        line(
            "assistant",
            "a3",
            Some("u2"),
            4,
            assistant(
                "msg_b",
                json!([{ "type": "tool_use", "id": "toolu_read", "name": "Read", "input": { "file_path": "/tmp/shot.png" } }]),
            ),
        ),
        line(
            "user",
            "u3",
            Some("a3"),
            5,
            user(json!([{
                "type": "tool_result",
                "tool_use_id": "toolu_read",
                "content": [image(&read, "image/png")],
            }])),
        ),
        line(
            "assistant",
            "a4",
            Some("u3"),
            6,
            assistant(
                "msg_c",
                json!([{ "type": "text", "text": "Both frames show the login page." }]),
            ),
        ),
        line(
            "user",
            "u4",
            Some("a4"),
            7,
            user(json!([
                image(&first, "image/png"),
                { "type": "text", "text": "And this one again?" },
            ])),
        ),
        line(
            "assistant",
            "a5",
            Some("u4"),
            8,
            assistant(
                "msg_d",
                json!([{ "type": "text", "text": "That is the same image." }]),
            ),
        ),
    ]
    .join("\n")
        + "\n"
}

pub async fn load_raw() -> Vec<ChatMessage> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("{SESSION_ID}.jsonl"));
    tokio::fs::write(&path, transcript()).await.unwrap();
    load_history(SESSION_ID, PROJECT_PATH, Some(path.to_str().unwrap()))
        .await
        .unwrap()
        .into_iter()
        .map(|mut message| {
            message.chat_id = CHAT_ID.to_string();
            message
        })
        .collect()
}

pub fn appended() -> RawChanges {
    [RawChange::Appended].into_iter().collect()
}
