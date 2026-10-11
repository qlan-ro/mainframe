use super::*;
use tokio::sync::mpsc;

fn read_request_id(rx: &mut mpsc::Receiver<Vec<u8>>) -> String {
    let bytes = rx.try_recv().expect("a control_request was written");
    let written: Value = serde_json::from_slice(&bytes).unwrap();
    written["request_id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn correlates_a_response_to_its_awaiting_caller_by_request_id() {
    let ch = ControlRequestChannel::new("s1".to_string());
    let (tx, mut rx) = StdinTx::channel(8);
    let request = json!({ "subtype": "set_model", "model": "x" });
    let opts = SendAwaitingOpts {
        label: "set_model".to_string(),
        timeout_ms: Some(1000),
        is_terminal: None,
    };
    let (result, ()) = tokio::join!(ch.send_awaiting(Some(&tx), &request, opts), async {
        let request_id = read_request_id(&mut rx);
        assert!(ch.resolve(&request_id, Some(json!({ "subtype": "success" }))));
    });
    assert_eq!(result, Some(json!({ "subtype": "success" })));
}

#[tokio::test]
async fn resolves_undefined_on_timeout() {
    let ch = ControlRequestChannel::new("s1".to_string());
    let result = ch
        .send_awaiting(
            None,
            &json!({ "subtype": "x" }),
            SendAwaitingOpts {
                label: "x".to_string(),
                timeout_ms: Some(10),
                is_terminal: None,
            },
        )
        .await;
    assert_eq!(result, None);
}

#[tokio::test]
async fn ignores_a_non_terminal_ack_then_resolves_on_the_terminal_shape() {
    let ch = ControlRequestChannel::new("s1".to_string());
    let (tx, mut rx) = StdinTx::channel(8);
    let request = json!({ "subtype": "cancel_async_message" });
    let opts = SendAwaitingOpts {
        label: "cancel_async_message".to_string(),
        timeout_ms: Some(5000),
        is_terminal: Some(Box::new(|r: &Raw| {
            r.as_ref()
                .and_then(|v| v.get("cancelled"))
                .map(Value::is_boolean)
                .unwrap_or(false)
        })),
    };
    let (result, ()) = tokio::join!(ch.send_awaiting(Some(&tx), &request, opts), async {
        let request_id = read_request_id(&mut rx);
        // intermediate — caller keeps waiting
        assert!(!ch.resolve(&request_id, Some(json!({ "ack": true }))));
        assert!(ch.resolve(&request_id, Some(json!({ "cancelled": true }))));
    });
    assert_eq!(result, Some(json!({ "cancelled": true })));
}

#[tokio::test]
async fn drain_all_as_failed_resolves_every_pending_caller_with_undefined() {
    let ch = ControlRequestChannel::new("s1".to_string());
    let opts = SendAwaitingOpts {
        label: "x".to_string(),
        timeout_ms: Some(10_000),
        is_terminal: None,
    };
    let request = json!({ "subtype": "x" });
    let (result, ()) = tokio::join!(ch.send_awaiting(None, &request, opts), async {
        ch.drain_all_as_failed();
    });
    assert_eq!(result, None);
}
