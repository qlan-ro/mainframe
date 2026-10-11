//! What a full stdin queue (an app-server that stopped reading) does to each
//! kind of write.

use super::*;
use mainframe_runtime::process::StdinWriter;
use tokio::sync::mpsc;

/// A client with no process behind it whose one-entry stdin queue is already
/// full; the returned receiver is never drained.
fn client_with_full_queue() -> (JsonRpcClient, mpsc::Receiver<Vec<u8>>) {
    let (write_tx, queue) = StdinWriter::channel(1);
    write_tx.try_write(b"backlog\n".to_vec()).unwrap();
    let client = JsonRpcClient {
        next_id: AtomicI64::new(1),
        pending: Arc::new(Mutex::new(HashMap::new())),
        closed: Arc::new(AtomicBool::new(false)),
        exited: Arc::new(AtomicBool::new(false)),
        close_notify: Arc::new(Notify::new()),
        kill_notify: Arc::new(Notify::new()),
        write_tx,
        request_timeout_ms: 60_000,
    };
    (client, queue)
}

#[tokio::test]
async fn a_request_fails_at_once_when_the_stdin_queue_is_full() {
    let (client, _queue) = client_with_full_queue();

    let result = tokio::time::timeout(Duration::from_secs(1), client.request("turn/start", None))
        .await
        .expect("must not wait for the request timeout");

    assert_eq!(
        result.unwrap_err().0,
        "Request turn/start (id=1) not written: child stdin queue full"
    );
    assert!(client.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_response_fails_when_the_stdin_queue_is_full() {
    let (client, _queue) = client_with_full_queue();

    let result = client.respond(
        RequestId::Number(7),
        serde_json::json!({ "decision": "accept" }),
    );

    assert_eq!(
        result.unwrap_err().0,
        "Response to request 7 not written: child stdin queue full"
    );
}

#[tokio::test]
async fn a_response_to_a_closed_client_is_not_an_error() {
    let (client, _queue) = client_with_full_queue();
    client.close();

    assert!(
        client
            .respond(RequestId::Number(7), serde_json::json!({}))
            .is_ok()
    );
}
