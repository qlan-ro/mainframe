use std::{io, process::Output, time::Duration};

use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    sync::oneshot,
};

/// The `code` a failed exec reports: a numeric exit status, or a text code
/// such as `ETIMEDOUT`/`ENOENT` when the process never produced one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecCode {
    Number(i64),
    Text(String),
}

/// Why a captured run did not complete. The child is killed and reaped on
/// every error variant, and when the owning future is cancelled.
#[derive(Debug, thiserror::Error)]
pub enum ExecError {
    #[error("{0}")]
    Spawn(io::Error),
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("command timed out")]
    Timeout,
    #[error("command output limit exceeded")]
    OutputLimit,
}

/// Run `command` to completion with stdin closed and both streams captured.
/// `timeout` bounds the whole run; `None` waits indefinitely.
pub async fn run_captured(
    command: Command,
    timeout: Option<Duration>,
) -> Result<Output, ExecError> {
    run_captured_limited(command, timeout, usize::MAX).await
}

/// [`run_captured`] with a per-stream byte cap; exceeding it kills the child
/// and reports [`ExecError::OutputLimit`].
pub async fn run_captured_limited(
    mut command: Command,
    timeout: Option<Duration>,
    stream_limit: usize,
) -> Result<Output, ExecError> {
    let child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(ExecError::Spawn)?;
    let (cancel, cancelled) = oneshot::channel::<()>();
    let owner = tokio::spawn(own_capture(child, timeout, stream_limit, cancelled));
    let result = owner
        .await
        .map_err(|error| io::Error::other(error.to_string()))?;
    drop(cancel);
    result
}

async fn own_capture(
    mut child: Child,
    timeout: Option<Duration>,
    limit: usize,
    cancelled: oneshot::Receiver<()>,
) -> Result<Output, ExecError> {
    let result = tokio::select! {
        result = capture(&mut child, limit) => result,
        () = deadline(timeout) => Err(ExecError::Timeout),
        _ = cancelled => Err(io::Error::new(io::ErrorKind::Interrupted, "command cancelled").into()),
    };
    if result.is_err()
        && let Err(error) = child.kill().await
    {
        tracing::warn!(%error, "failed to kill and reap captured child");
        if let Err(error) = child.wait().await {
            tracing::warn!(%error, "failed to reap captured child");
        }
    }
    result
}

async fn deadline(timeout: Option<Duration>) {
    match timeout {
        Some(duration) => tokio::time::sleep(duration).await,
        None => std::future::pending().await,
    }
}

async fn capture(child: &mut Child, limit: usize) -> Result<Output, ExecError> {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (stdout, stderr, status) =
        tokio::try_join!(read(stdout, limit), read(stderr, limit), async {
            child.wait().await.map_err(ExecError::Io)
        },)?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

async fn read(reader: Option<impl AsyncRead + Unpin>, limit: usize) -> Result<Vec<u8>, ExecError> {
    let Some(mut reader) = reader else {
        return Ok(Vec::new());
    };
    let mut output = Vec::new();
    let mut chunk = [0; 8192];
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            return Ok(output);
        }
        if count > limit.saturating_sub(output.len()) {
            return Err(ExecError::OutputLimit);
        }
        output.extend_from_slice(&chunk[..count]);
    }
}
