//! Binary history frames over a real `/acp/{profile}` socket: an opted-in
//! client gets `batchFrames` in the JSON-RPC result and the batches as binary
//! WebSocket messages tied to the request id, in between other traffic; a
//! client that did not opt in gets only text frames, as before.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

mod support;

use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use mainframe_types::chat::MessageContent;
use serde_json::{Value, json};
use support::facade::{FacadeServer, spawn_facade_server_with};
use support::tool_timing_adapter::ToolTimingAdapter;

enum WsMessage {
    Text(String),
    Binary(Vec<u8>),
}

/// A minimal RFC-6455 client that, unlike `support::WsClient`, hands binary
/// messages to the caller.
struct WsClient {
    stream: tokio::io::BufReader<tokio::net::TcpStream>,
}

impl WsClient {
    async fn connect(addr: std::net::SocketAddr, path: &str) -> Self {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut reader = tokio::io::BufReader::new(stream);
        loop {
            let mut line = String::new();
            let read = reader.read_line(&mut line).await.unwrap();
            if read == 0 || line == "\r\n" {
                break;
            }
        }
        Self { stream: reader }
    }

    async fn send_json(&mut self, value: &Value) {
        use tokio::io::AsyncWriteExt;
        let payload = value.to_string().into_bytes();
        let key = [0x12u8, 0x34, 0x56, 0x78];
        let mut frame = vec![0x81u8, 0x80 | 127];
        frame.extend((payload.len() as u64).to_be_bytes());
        frame.extend(key);
        frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ key[i % 4]));
        self.stream.get_mut().write_all(&frame).await.unwrap();
    }

    async fn read_message(&mut self) -> Option<WsMessage> {
        use tokio::io::AsyncReadExt;
        loop {
            let mut head = [0u8; 2];
            self.stream.read_exact(&mut head).await.ok()?;
            let len = match head[1] & 0x7F {
                126 => {
                    let mut b = [0u8; 2];
                    self.stream.read_exact(&mut b).await.ok()?;
                    u16::from_be_bytes(b) as usize
                }
                127 => {
                    let mut b = [0u8; 8];
                    self.stream.read_exact(&mut b).await.ok()?;
                    u64::from_be_bytes(b) as usize
                }
                n => n as usize,
            };
            let mut payload = vec![0u8; len];
            self.stream.read_exact(&mut payload).await.ok()?;
            match head[0] & 0x0F {
                0x1 => return Some(WsMessage::Text(String::from_utf8(payload).unwrap())),
                0x2 => return Some(WsMessage::Binary(payload)),
                0x8 => return None,
                _ => continue,
            }
        }
    }
}

async fn connect(facade: &FacadeServer, meta: Value) -> WsClient {
    let mut ws = WsClient::connect(facade.server.addr, &format!("/acp/{}", facade.profile)).await;
    ws.send_json(&json!({"jsonrpc":"2.0","id":0,"method":"initialize",
        "params":{"protocolVersion":2,"info":{"name":"binary-test","version":"1"},
        "_meta":{"_mainframe.dev":meta}}}))
        .await;
    loop {
        if let Some(WsMessage::Text(text)) =
            tokio::time::timeout(Duration::from_secs(5), ws.read_message())
                .await
                .unwrap()
        {
            let reply: Value = serde_json::from_str(&text).unwrap();
            if reply["id"] == 0 {
                assert!(reply.get("result").is_some());
                return ws;
            }
        }
    }
}

fn tool(id: &str) -> MessageContent {
    serde_json::from_value(json!({"type":"tool_use","id":id,"name":"Bash",
        "input":{"description":"Inspect"},"parentToolUseId":null}))
    .unwrap()
}

/// Read until the response to `id`, collecting binary frames seen on the way
/// (before or after it) until `expected` of them arrived.
async fn collect(ws: &mut WsClient, id: i64, expected: Option<usize>) -> (Value, Vec<Vec<u8>>) {
    let mut response = None;
    let mut frames: Vec<Vec<u8>> = Vec::new();
    let mut frames_at_response = 0;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match ws.read_message().await.expect("socket closed") {
                WsMessage::Text(text) => {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["id"] == id {
                        frames_at_response = frames.len();
                        response = Some(value);
                    }
                }
                WsMessage::Binary(frame) => frames.push(frame),
            }
            let want = expected.or_else(|| {
                response
                    .as_ref()
                    .map(|r| r["result"]["batchFrames"].as_u64().unwrap_or(0) as usize)
            });
            if response.is_some() && want.is_some_and(|want| frames.len() >= want) {
                return;
            }
        }
    })
    .await
    .expect("response and frames");
    let response = response.unwrap();
    // The daemon writes a response's frames ahead of the response itself.
    let announced = response["result"]["batchFrames"].as_u64().unwrap_or(0) as usize;
    assert_eq!(frames_at_response, announced.min(frames.len()));
    (response, frames)
}

/// A facade server whose chat holds one tool call, and the request that
/// asks for a window around it.
async fn server_with_tool_call() -> (FacadeServer, Value) {
    let adapter = Arc::new(ToolTimingAdapter::default());
    let facade = spawn_facade_server_with(adapter.clone(), 50).await;
    let mut ws = connect(
        &facade,
        json!({"compressedReplay":true,"binaryHistoryFrames":true}),
    )
    .await;
    ws.send_json(&json!({"jsonrpc":"2.0","id":1,"method":"session/prompt",
        "params":{"sessionId":facade.chat_id,"prompt":[{"type":"text","text":"run tools"}]}}))
        .await;
    collect(&mut ws, 1, Some(0)).await;
    adapter.sink().on_message(vec![tool("a")], None);
    // The live update for the tool call means the item is in the transcript.
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(message) = ws.read_message().await {
            if let WsMessage::Text(text) = message
                && text.contains("\"toolCallId\":\"tool:a\"")
            {
                return;
            }
        }
        panic!("socket closed before the tool call arrived");
    })
    .await
    .expect("tool call update");
    let around = json!({"jsonrpc":"2.0","id":9,"method":"_mainframe.dev/history_around",
        "params":{"sessionId":facade.chat_id,"itemId":"tool:a"}});
    (facade, around)
}

#[tokio::test]
async fn an_opted_in_socket_receives_binary_frames_ahead_of_the_response() {
    let (facade, around) = server_with_tool_call().await;
    let mut ws = connect(
        &facade,
        json!({"compressedReplay":true,"binaryHistoryFrames":true}),
    )
    .await;
    ws.send_json(&around).await;
    let (response, frames) = collect(&mut ws, 9, None).await;
    assert!(response["result"].get("stale").is_none(), "{response}");
    let result = &response["result"];
    assert!(result.get("batches").is_none() && result.get("updates").is_none());
    assert_eq!(result["batchFrames"], frames.len());
    assert!(!frames.is_empty());
    let mut ids = Vec::new();
    for (index, raw) in frames.iter().enumerate() {
        let frame = mainframe_acp::binary_frame::decode_frame(raw).unwrap();
        assert_eq!(
            (frame.id, frame.index, frame.total),
            ("9", index, frames.len())
        );
        let mut text = String::new();
        flate2::read::ZlibDecoder::new(frame.payload)
            .read_to_string(&mut text)
            .unwrap();
        let batch: Vec<Value> = serde_json::from_str(&text).unwrap();
        assert_eq!(batch.len(), frame.count);
        ids.extend(
            batch
                .iter()
                .filter_map(|u| u["toolCallId"].as_str().map(str::to_owned)),
        );
    }
    assert!(ids.iter().any(|id| id == "tool:a"), "{ids:?}");
}

#[tokio::test]
async fn a_socket_that_did_not_opt_in_gets_text_only() {
    let (facade, around) = server_with_tool_call().await;
    let mut old = connect(&facade, json!({"compressedReplay":true})).await;
    old.send_json(&json!({"jsonrpc":"2.0","id":3,"method":"session/resume",
        "params":{"sessionId":facade.chat_id,"cwd":"/tmp"}}))
        .await;
    collect(&mut old, 3, Some(0)).await;
    old.send_json(&around).await;
    let (response, frames) = collect(&mut old, 9, Some(0)).await;
    assert!(response["result"].get("batchFrames").is_none());
    assert!(response["result"].get("batches").is_some());
    assert!(frames.is_empty());
    // Nothing binary ever shows up for it afterwards either.
    assert!(
        tokio::time::timeout(Duration::from_millis(300), async {
            loop {
                if let Some(WsMessage::Binary(_)) = old.read_message().await {
                    return;
                }
            }
        })
        .await
        .is_err()
    );
}
