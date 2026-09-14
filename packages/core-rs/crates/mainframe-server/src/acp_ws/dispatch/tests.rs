#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::Mutex;

use mainframe_acp::gates::OPTION_ALLOW_ONCE;
use mainframe_chat::permission_handler::PermissionError;
use mainframe_types::acp::permission::{RequestPermissionOutcome, RequestPermissionResponse};
use mainframe_types::adapter::{ControlRequest, ControlResponse};

use super::super::facade_conn::rpc_id_string;
use super::super::hub::FacadeHub;
use super::super::ports::GatePort;
use super::*;

fn control_request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "toolu_01A".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
    }
}

fn allow_once_answer() -> RequestPermissionResponse {
    RequestPermissionResponse {
        outcome: RequestPermissionOutcome::Selected {
            option_id: OPTION_ALLOW_ONCE.to_string(),
        },
        meta: None,
    }
}

/// Errs on its first call, then succeeds — a retried answer must reach it.
struct FlakyPort {
    calls: Mutex<Vec<ControlResponse>>,
    remaining_failures: Mutex<u32>,
}

impl FlakyPort {
    fn new(remaining_failures: u32) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            remaining_failures: Mutex::new(remaining_failures),
        }
    }

    fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

impl GatePort for FlakyPort {
    fn respond_to_permission<'a>(
        &'a self,
        _chat_id: &'a str,
        response: ControlResponse,
    ) -> mainframe_acp::prompt::BoxFuture<'a, Result<(), PermissionError>> {
        self.calls.lock().unwrap().push(response);
        Box::pin(async move {
            let mut remaining = self.remaining_failures.lock().unwrap();
            if *remaining > 0 {
                *remaining -= 1;
                Err(PermissionError::Message("transport failure".to_string()))
            } else {
                Ok(())
            }
        })
    }
}

#[tokio::test]
async fn a_failed_apply_leaves_the_gate_answerable() {
    let hub = FacadeHub::new(100);
    let (_client_id, connection, _rx) = hub.register("mock-cli".to_string());
    let request = control_request("req-1");
    let rpc_id = rpc_id_string(&request.request_id);
    let frame = mainframe_acp::build_permission_request(
        "chat-1",
        mainframe_acp::gate_request_id(&request.request_id),
        &request,
    );
    connection.deliver_gate("chat-1", &request, &frame);

    let ports = FlakyPort::new(1);

    // First attempt fails: the gate must still be answerable afterward.
    let pending = connection
        .peek_gate(&rpc_id)
        .expect("gate must be pending before the first attempt");
    apply_gate_answer(
        &rpc_id,
        pending,
        allow_once_answer(),
        &hub,
        &ports,
        &connection,
    )
    .await;
    assert_eq!(ports.call_count(), 1);
    assert!(
        connection.peek_gate(&rpc_id).is_some(),
        "a failed apply must leave the gate answerable"
    );

    // Retry with the SAME rpc_id reaches the port and succeeds.
    let pending = connection
        .peek_gate(&rpc_id)
        .expect("gate must still be pending for the retry");
    apply_gate_answer(
        &rpc_id,
        pending,
        allow_once_answer(),
        &hub,
        &ports,
        &connection,
    )
    .await;
    assert_eq!(ports.call_count(), 2);
    assert!(
        connection.peek_gate(&rpc_id).is_none(),
        "a successful apply must clear the gate"
    );
}
