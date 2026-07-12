//! Translated from `packages/core/src/__tests__/lsp/lsp-proxy.test.ts`.

use super::*;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

#[test]
fn encode_json_rpc_wraps_json_with_content_length_header() {
    let json = r#"{"jsonrpc":"2.0","id":1}"#;
    let encoded = encode_json_rpc(json);
    let expected = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);
    assert_eq!(encoded, expected);
}

#[test]
fn frame_parser_decodes_a_complete_frame() {
    let json = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
    let frame = encode_json_rpc(json);
    let mut parser = LspFrameParser::new();
    let out = parser.push(frame.as_bytes());
    assert_eq!(out, vec![json.to_string()]);
}

#[test]
fn frame_parser_reassembles_split_chunks() {
    let json = r#"{"jsonrpc":"2.0","id":7}"#;
    let frame = encode_json_rpc(json);
    let bytes = frame.as_bytes();
    let (a, b) = bytes.split_at(bytes.len() - 5);

    let mut parser = LspFrameParser::new();
    assert!(parser.push(a).is_empty());
    assert_eq!(parser.push(b), vec![json.to_string()]);
}

#[test]
fn frame_parser_decodes_multiple_frames_in_one_chunk() {
    let a = r#"{"id":1}"#;
    let b = r#"{"id":2}"#;
    let combined = format!("{}{}", encode_json_rpc(a), encode_json_rpc(b));
    let mut parser = LspFrameParser::new();
    assert_eq!(
        parser.push(combined.as_bytes()),
        vec![a.to_string(), b.to_string()]
    );
}

#[test]
fn frame_parser_discards_malformed_header() {
    // A header block with no Content-Length is discarded; the following valid
    // frame still decodes.
    let json = r#"{"id":9}"#;
    let input = format!("X-Bad: 1\r\n\r\n{}", encode_json_rpc(json));
    let mut parser = LspFrameParser::new();
    assert_eq!(parser.push(input.as_bytes()), vec![json.to_string()]);
}

#[tokio::test]
async fn forwards_ws_message_to_stdin_with_content_length_framing() {
    let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<String>();
    let (outgoing_tx, _outgoing_rx) = mpsc::unbounded_channel::<String>();
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (_so_w, so_r) = tokio::io::duplex(1024);
    let (_se_w, se_r) = tokio::io::duplex(1024);

    let _bridge = bridge_ws_to_process(incoming_rx, outgoing_tx, stdin_tx, so_r, se_r);

    let json = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    incoming_tx.send(json.to_string()).unwrap();

    let written = stdin_rx.recv().await.unwrap();
    let written = String::from_utf8(written).unwrap();
    assert!(written.contains("Content-Length:"));
    assert!(written.contains(json));
}

#[tokio::test]
async fn forwards_stdout_content_length_messages_to_ws() {
    let (_incoming_tx, incoming_rx) = mpsc::unbounded_channel::<String>();
    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<String>();
    let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (mut so_w, so_r) = tokio::io::duplex(1024);
    let (_se_w, se_r) = tokio::io::duplex(1024);

    let _bridge = bridge_ws_to_process(incoming_rx, outgoing_tx, stdin_tx, so_r, se_r);

    let json = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
    so_w.write_all(encode_json_rpc(json).as_bytes())
        .await
        .unwrap();

    let received = outgoing_rx.recv().await.unwrap();
    assert_eq!(received, json);
}

#[tokio::test]
async fn cleanup_aborts_the_pump_tasks() {
    let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<String>();
    let (outgoing_tx, _outgoing_rx) = mpsc::unbounded_channel::<String>();
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (_so_w, so_r) = tokio::io::duplex(1024);
    let (_se_w, se_r) = tokio::io::duplex(1024);

    let bridge = bridge_ws_to_process(incoming_rx, outgoing_tx, stdin_tx, so_r, se_r);
    bridge.cleanup();
    // Give the abort a moment to take effect.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;

    // After cleanup the stdin pump is gone: the send either fails (its receiver
    // was dropped with the aborted task) or is never framed. Either way nothing
    // reaches stdin.
    let _ = incoming_tx.send("{}".to_string());
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(stdin_rx.try_recv().is_err());
}
