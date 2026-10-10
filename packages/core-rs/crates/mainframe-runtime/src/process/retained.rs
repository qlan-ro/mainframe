use mainframe_types::sync::LockExt;
use std::{
    io,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::oneshot,
    task::JoinHandle,
};

/// Output retained from a captured run that may have hit its deadline:
/// `exit_code` is `None` when `timed_out`.
pub struct RetainedOutput {
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Run `command` with stdin closed, keeping the first `limit` bytes of each
/// stream even when `timeout` kills the child. Once the child is gone the
/// readers get [`super::PUMP_DRAIN_GRACE`] to finish; a grandchild still
/// holding the pipes cannot extend the deadline, and whatever was read by then
/// is returned.
pub async fn run_captured_prefix(
    mut command: Command,
    timeout: Duration,
    limit: usize,
) -> io::Result<RetainedOutput> {
    let mut child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (cancel, cancelled) = oneshot::channel::<()>();
    let owner = tokio::spawn(async move {
        let stdout = PrefixReader::spawn(stdout, limit);
        let stderr = PrefixReader::spawn(stderr, limit);
        let (timed_out, status) = tokio::select! {
            result = child.wait() => (false, result),
            () = tokio::time::sleep(timeout) => (true, stop(&mut child).await),
            _ = cancelled => (false, stop(&mut child).await),
        };
        let exit_code = match status {
            Ok(status) if !timed_out => status.code(),
            Ok(_) => None,
            Err(error) => {
                tracing::warn!(%error, "captured child wait failed");
                None
            }
        };
        RetainedOutput {
            timed_out,
            exit_code,
            stdout: stdout.finish().await,
            stderr: stderr.finish().await,
        }
    });
    let result = owner
        .await
        .map_err(|error| io::Error::other(error.to_string()));
    drop(cancel);
    result
}

async fn stop(child: &mut tokio::process::Child) -> io::Result<std::process::ExitStatus> {
    if let Err(error) = child.start_kill() {
        tracing::warn!(%error, "captured child kill failed");
    }
    child.wait().await
}

/// Reads a stream's prefix into a buffer the owner can take back even when the
/// reader is still blocked on a pipe held open by a grandchild.
struct PrefixReader {
    output: Arc<Mutex<Vec<u8>>>,
    task: JoinHandle<()>,
}

impl PrefixReader {
    fn spawn(reader: Option<impl AsyncRead + Unpin + Send + 'static>, limit: usize) -> Self {
        let output = Arc::new(Mutex::new(Vec::new()));
        let sink = output.clone();
        let task = tokio::spawn(async move {
            let Some(mut reader) = reader else { return };
            let mut chunk = [0; 8192];
            loop {
                let count = match reader.read(&mut chunk).await {
                    Ok(0) => return,
                    Ok(count) => count,
                    Err(error) => {
                        tracing::debug!(%error, "prefix capture reader closed");
                        return;
                    }
                };
                let mut output = sink.lock_recover();
                if output.len() >= limit {
                    return;
                }
                output.extend_from_slice(&chunk[..count]);
            }
        });
        Self { output, task }
    }

    async fn finish(mut self) -> Vec<u8> {
        if tokio::time::timeout(super::PUMP_DRAIN_GRACE, &mut self.task)
            .await
            .is_err()
        {
            self.task.abort();
        }
        std::mem::take(&mut *self.output.lock_recover())
    }
}
