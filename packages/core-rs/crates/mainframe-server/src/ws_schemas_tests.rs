use super::*;

#[test]
fn parses_a_valid_subscribe() {
    let event = parse_client_event(r#"{"type":"subscribe","chatId":"c1"}"#).unwrap();
    assert!(matches!(event, ClientEvent::Subscribe { chat_id } if chat_id == "c1"));
}

#[test]
fn rejects_non_json() {
    assert_eq!(
        parse_client_event("not json{"),
        Err(ClientEventError::InvalidJson)
    );
}

#[test]
fn rejects_unknown_type() {
    assert!(matches!(
        parse_client_event(r#"{"type":"bogus"}"#),
        Err(ClientEventError::Invalid(_))
    ));
}

#[test]
fn rejects_empty_chat_id() {
    let err = parse_client_event(r#"{"type":"subscribe","chatId":""}"#).unwrap_err();
    assert_eq!(err.to_string(), "Invalid message: chatId must be non-empty");
    assert_eq!(ClientEventError::InvalidJson.to_string(), "Invalid JSON");
}

#[test]
fn rejects_subscribe_file_with_empty_path() {
    let err = parse_client_event(r#"{"type":"subscribe:file","path":""}"#).unwrap_err();
    assert_eq!(err.to_string(), "Invalid message: path must be non-empty");
}

#[test]
fn accepts_relative_subscribe_file_with_project_id() {
    let event =
        parse_client_event(r#"{"type":"subscribe:file","path":"src/a.ts","projectId":"p1"}"#)
            .unwrap();
    assert!(matches!(event, ClientEvent::SubscribeFile { .. }));
}

#[test]
fn rejects_the_retired_message_send_frame() {
    // The legacy chat dialect is gone: `message.send` now fails the union
    // parse like any unknown type (prompts ride `/acp/{profile}`).
    assert!(matches!(
        parse_client_event(r#"{"type":"message.send","chatId":"c1","content":"hi"}"#),
        Err(ClientEventError::Invalid(_))
    ));
}
