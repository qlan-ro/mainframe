use super::*;

#[test]
fn encode_prefixes_the_utf8_byte_length() {
    assert_eq!(
        encode(r#"{"a":"é"}"#),
        b"Content-Length: 10\r\n\r\n{\"a\":\"\xc3\xa9\"}".to_vec()
    );
}

#[test]
fn decodes_a_complete_frame() {
    let json = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
    assert_eq!(FrameParser::default().push(&encode(json)), vec![json]);
}

#[test]
fn reassembles_split_chunks() {
    let json = r#"{"jsonrpc":"2.0","id":7}"#;
    let frame = encode(json);
    let (head, tail) = frame.split_at(frame.len() - 5);
    let mut parser = FrameParser::default();
    assert!(parser.push(head).is_empty());
    assert_eq!(parser.push(tail), vec![json]);
}

#[test]
fn decodes_multiple_frames_in_one_chunk() {
    let mut bytes = encode(r#"{"id":1}"#);
    bytes.extend(encode(r#"{"id":2}"#));
    assert_eq!(
        FrameParser::default().push(&bytes),
        vec![r#"{"id":1}"#, r#"{"id":2}"#]
    );
}

#[test]
fn reads_the_length_among_other_header_fields() {
    let json = r#"{"id":3}"#;
    let input = format!(
        "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length:  {}\r\n\r\n{json}",
        json.len()
    );
    assert_eq!(FrameParser::default().push(input.as_bytes()), vec![json]);
}

#[test]
fn discards_a_header_without_a_usable_length() {
    let json = r#"{"id":9}"#;
    for bad in [
        "X-Bad: 1".to_string(),
        format!("Content-Length: {}", usize::MAX),
    ] {
        let mut input = format!("{bad}\r\n\r\n").into_bytes();
        input.extend(encode(json));
        assert_eq!(FrameParser::default().push(&input), vec![json], "{bad}");
    }
}
