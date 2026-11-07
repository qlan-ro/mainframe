use std::{
    future::Future,
    io,
    pin::Pin,
    process::{ExitStatus, Output},
    time::Duration,
};

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
    #[error(transparent)]
    Spawn(io::Error),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("command timed out")]
    Timeout,
    #[error("command output limit exceeded")]
    OutputLimit,
}

/// Output retained from a captured run that may have hit its deadline:
/// `exit_code` is `None` when `timed_out` or when a signal ended the child.
pub struct RetainedOutput {
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Run `command` to completion with stdin closed and both streams captured.
/// `timeout` bounds the wait for exit; `None` waits indefinitely. Once the child
/// exits its streams get [`super::PUMP_DRAIN_GRACE`], so a background job that
/// inherited a pipe cannot hold the result. The job keeps running and its later
/// output is discarded.
pub async fn run_captured(
    command: Command,
    timeout: Option<Duration>,
) -> Result<Output, ExecError> {
    run_captured_limited(command, timeout, usize::MAX).await
}

/// [`run_captured`] with a per-stream byte cap; exceeding it kills the child
/// and reports [`ExecError::OutputLimit`].
pub async fn run_captured_limited(
    command: Command,
    timeout: Option<Duration>,
    stream_limit: usize,
) -> Result<Output, ExecError> {
    let child = spawn_piped(command).map_err(ExecError::Spawn)?;
    let run = supervise(child, timeout, stream_limit, Overflow::Fail).await?;
    Ok(Output {
        status: run.ended?,
        stdout: run.stdout,
        stderr: run.stderr,
    })
}

/// [`run_captured`] that keeps the first `limit` bytes of each stream, even
/// when `timeout` kills the child. Output past the limit is read and
/// discarded, so a chatty child runs to completion instead of dying on a
/// closed pipe.
pub async fn run_captured_prefix(
    command: Command,
    timeout: Duration,
    limit: usize,
) -> io::Result<RetainedOutput> {
    let child = spawn_piped(command)?;
    let run = supervise(child, Some(timeout), limit, Overflow::Discard).await?;
    let (timed_out, exit_code) = match run.ended {
        Ok(status) => (false, status.code()),
        Err(ExecError::Timeout) => (true, None),
        Err(error) => {
            tracing::warn!(%error, "captured child failed");
            (false, None)
        }
    };
    Ok(RetainedOutput {
        timed_out,
        exit_code,
        stdout: run.stdout,
        stderr: run.stderr,
    })
}

/// What a stream does with bytes past its limit.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Overflow {
    Fail,
    Discard,
}

/// The output read by the time a run ended, kept even when it ended badly.
struct Run {
    ended: Result<ExitStatus, ExecError>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn spawn_piped(mut command: Command) -> io::Result<Child> {
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

/// The owner task outlives a cancelled caller: dropping this future drops
/// `cancel`, and the owner kills and reaps the child.
async fn supervise(
    child: Child,
    timeout: Option<Duration>,
    limit: usize,
    overflow: Overflow,
) -> io::Result<Run> {
    let (cancel, cancelled) = oneshot::channel::<()>();
    let owner = tokio::spawn(own_capture(child, timeout, limit, overflow, cancelled));
    let run = owner
        .await
        .map_err(|error| io::Error::other(error.to_string()))?;
    drop(cancel);
    Ok(run)
}

async fn own_capture(
    mut child: Child,
    timeout: Option<Duration>,
    limit: usize,
    overflow: Overflow,
    cancelled: oneshot::Receiver<()>,
) -> Run {
    let (mut stdout_pipe, mut stderr_pipe) = (child.stdout.take(), child.stderr.take());
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let ended = {
        let streams = async {
            tokio::try_join!(
                read(&mut stdout_pipe, limit, overflow, &mut stdout),
                read(&mut stderr_pipe, limit, overflow, &mut stderr),
            )
            .map(|_| ())
        };
        tokio::pin!(streams);
        let exited = tokio::select! {
            result = wait_for_exit(&mut child, streams.as_mut()) => result,
            () = deadline(timeout) => Err(ExecError::Timeout),
            _ = cancelled => Err(io::Error::new(io::ErrorKind::Interrupted, "command cancelled").into()),
        };
        // The deadline covers the child, not this drain: an exit it made in
        // time must not turn into a timeout.
        match exited {
            Ok((status, true)) => Ok(status),
            Ok((status, false)) => finish_streams(streams).await.map(|()| status),
            Err(error) => Err(error),
        }
    };
    if ended.is_ok() {
        keep_draining(stdout_pipe);
        keep_draining(stderr_pipe);
    } else if let Err(error) = child.kill().await {
        tracing::warn!(%error, "failed to kill and reap captured child");
        if let Err(error) = child.wait().await {
            tracing::warn!(%error, "failed to reap captured child");
        }
    }
    Run {
        ended,
        stdout,
        stderr,
    }
}

/// Waits for the child while draining its streams. The flag says whether the
/// streams had already finished.
async fn wait_for_exit(
    child: &mut Child,
    mut streams: Pin<&mut impl Future<Output = Result<(), ExecError>>>,
) -> Result<(ExitStatus, bool), ExecError> {
    tokio::select! {
        status = child.wait() => Ok((status?, false)),
        drained = &mut streams => {
            drained?;
            Ok((child.wait().await?, true))
        }
    }
}

async fn finish_streams(
    streams: Pin<&mut impl Future<Output = Result<(), ExecError>>>,
) -> Result<(), ExecError> {
    tokio::time::timeout(super::PUMP_DRAIN_GRACE, streams)
        .await
        .unwrap_or_else(|_| {
            tracing::debug!("captured stream still open after child exit");
            Ok(())
        })
}

/// A background job can outlive the child on an inherited pipe. Closing the
/// read end would kill it with SIGPIPE on its next write, so the rest is read
/// and discarded until the job closes the pipe.
fn keep_draining(pipe: Option<impl AsyncRead + Unpin + Send + 'static>) {
    if let Some(mut pipe) = pipe {
        tokio::spawn(async move {
            if let Err(error) = tokio::io::copy(&mut pipe, &mut tokio::io::sink()).await {
                tracing::debug!(%error, "abandoned stream closed");
            }
        });
    }
}

async fn deadline(timeout: Option<Duration>) {
    match timeout {
        Some(duration) => tokio::time::sleep(duration).await,
        None => std::future::pending().await,
    }
}

/// Reads `pipe` into `output`, clearing `pipe` at EOF. A pipe left set was not
/// read to its end.
async fn read(
    pipe: &mut Option<impl AsyncRead + Unpin>,
    limit: usize,
    overflow: Overflow,
    output: &mut Vec<u8>,
) -> Result<(), ExecError> {
    let Some(reader) = pipe else {
        return Ok(());
    };
    let mut chunk = [0; 8192];
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            *pipe = None;
            return Ok(());
        }
        let room = limit.saturating_sub(output.len());
        if count > room && overflow == Overflow::Fail {
            return Err(ExecError::OutputLimit);
        }
        output.extend_from_slice(&chunk[..count.min(room)]);
    }
}
