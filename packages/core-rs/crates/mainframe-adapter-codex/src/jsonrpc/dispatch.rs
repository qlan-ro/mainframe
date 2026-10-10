use super::*;

pub(super) fn dispatch(
    msg: &Map<String, Value>,
    pending: &Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    handlers: &Arc<JsonRpcHandlers>,
) {
    if is_json_rpc_response(msg) {
        if let Some(id) = msg.get("id").and_then(request_id_from_value)
            && let Some(tx) = pending.lock_recover().remove(&id)
        {
            let _ = tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
        }
        return;
    }

    if is_json_rpc_error(msg) {
        if let Some(id) = msg.get("id").and_then(request_id_from_value)
            && let Some(tx) = pending.lock_recover().remove(&id)
        {
            let message = msg
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            let _ = tx.send(Err(JsonRpcError(message)));
        }
        return;
    }

    if is_json_rpc_server_request(msg) {
        if let (Some(method), Some(id)) = (
            msg.get("method").and_then(|m| m.as_str()),
            msg.get("id").and_then(request_id_from_value),
        ) {
            (handlers.on_request)(
                method.to_string(),
                msg.get("params").cloned().unwrap_or(Value::Null),
                id,
            );
        }
        return;
    }

    if is_json_rpc_notification(msg) {
        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
            (handlers.on_notification)(
                method.to_string(),
                msg.get("params").cloned().unwrap_or(Value::Null),
            );
        }
        return;
    }

    tracing::warn!(
        module = "codex:jsonrpc",
        "jsonrpc: unrecognized message shape"
    );
}
