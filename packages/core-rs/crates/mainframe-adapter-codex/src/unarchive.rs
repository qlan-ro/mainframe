//! Codex's remedy for [`AdapterError::NativeSessionArchived`]: `thread/unarchive`
//! on a short-lived app-server, the same way `fork_pin` reads a thread. Codex
//! moves the rollout back into `~/.codex/sessions` and clears the archive flag,
//! after which `thread/resume` accepts the thread again.

use mainframe_adapter_api::AdapterError;
use serde_json::json;

use crate::session::spawn_temp_app_server;

pub(crate) async fn unarchive_thread(
    thread_id: &str,
    cwd: &str,
    executable: &str,
    resolved_path: &str,
) -> Result<(), AdapterError> {
    let temp = spawn_temp_app_server(
        executable,
        Some(std::path::Path::new(cwd)),
        true,
        resolved_path,
    )
    .await?;
    let result = temp
        .request("thread/unarchive", Some(json!({ "threadId": thread_id })))
        .await;
    temp.close();
    result.map(|_| ()).map_err(AdapterError::from)
}
