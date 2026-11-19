use super::{
    input::{ReadInput, parse},
    reads,
    test_support::Server,
};
use mainframe_types::{
    chat::{ChatMessage, ChatMessageType, MessageContent},
    content::LeafContent,
};
use serde_json::json;

#[tokio::test]
async fn long_unicode_message_can_be_reassembled_without_losing_the_tail() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let client = serde_json::from_value(grant["client"].clone()).unwrap();
    let chat = reads::target(&s.ctx, &client, &s.chat).await.unwrap();
    let text = "ă🙂".repeat(1400);
    let messages = [ChatMessage {
        id: "long-message".into(),
        chat_id: s.chat.clone(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: text.clone(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-01-01T00:00:00Z".into(),
        metadata: None,
    }];
    let mut offset = 0;
    let mut whole = String::new();
    loop {
        let args: ReadInput =
            parse(json!({"chatId":s.chat,"messageId":"long-message","textOffset":offset})).unwrap();
        let result = reads::read_message(
            &chat,
            &messages,
            args.message_id.as_deref().unwrap(),
            args.text_offset,
            false,
        )
        .unwrap();
        let item = &result["items"][0];
        whole.push_str(item["text"].as_str().unwrap());
        if item["textTruncated"] == false {
            break;
        }
        offset = item["nextTextOffset"].as_u64().unwrap() as usize;
    }
    assert_eq!(whole, text);
    assert!(reads::read_message(&chat, &messages, "long-message", 2801, false).is_err());
    assert!(reads::read_message(&chat, &messages, "missing", 0, false).is_err());
    assert!(reads::read_message(&chat, &messages, "long-message", 0, true).is_err());
}

#[tokio::test]
async fn unsupported_auto_mode_is_rejected_for_launch_and_configuration() {
    let s = Server::start().await;
    let grant = s.grant("control", "yolo").await;
    let token = grant["token"].as_str().unwrap();
    for (tool, args) in [
        (
            "chat_launch",
            json!({"projectId":s.project,"adapterId":"claude","permissionMode":"auto","prompt":"Hi"}),
        ),
        (
            "chat_configure",
            json!({"chatId":s.chat,"permissionMode":"auto"}),
        ),
    ] {
        let result = s.call(token, tool, args).await;
        assert_eq!(result["result"]["isError"], true);
    }
}
