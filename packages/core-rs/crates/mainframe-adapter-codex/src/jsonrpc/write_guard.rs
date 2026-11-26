use super::*;
use mainframe_runtime::process::spawn_filtered_stdin_writer;

pub(super) fn guarded_writer(
    stdin: Option<tokio::process::ChildStdin>,
    pending: Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    guards: WriteGuards,
) -> mainframe_runtime::process::StdinWriter {
    spawn_filtered_stdin_writer(stdin, move |line| allow_write(line, &pending, &guards))
}

pub(super) fn allow_write(
    line: &[u8],
    pending: &Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    guards: &WriteGuards,
) -> bool {
    if guards.lock_recover().is_empty() {
        return true;
    }
    let Some(id) = serde_json::from_slice::<Value>(line).ok().and_then(|msg| {
        msg.get("method")?;
        msg["id"].as_i64()
    }) else {
        return true;
    };
    let guard = guards.lock_recover().remove(&id);
    let Some(guard) = guard else {
        return true;
    };
    let id = RequestId::Number(id);
    if pending.lock_recover().contains_key(&id) && guard() {
        return true;
    }
    if let Some(reply) = pending.lock_recover().remove(&id) {
        let _ = /* expected */ reply.send(Err(RpcFailure::NotWritten(cancelled_write())));
    }
    false
}
