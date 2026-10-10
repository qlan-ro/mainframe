use std::{io, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::oneshot,
};

pub struct RetainedOutput {
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub async fn run_captured_prefix(
    mut command: Command,
    timeout: Duration,
    limit: usize,
) -> io::Result<RetainedOutput> {
    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (cancel, cancelled) = oneshot::channel::<()>();
    let owner = tokio::spawn(async move {
        let stdout = tokio::spawn(read_prefix(stdout, limit));
        let stderr = tokio::spawn(read_prefix(stderr, limit));
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
            stdout: stdout.await.unwrap_or_default(),
            stderr: stderr.await.unwrap_or_default(),
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

async fn read_prefix(reader: Option<impl AsyncRead + Unpin>, limit: usize) -> Vec<u8> {
    let Some(mut reader) = reader else {
        return Vec::new();
    };
    let mut output = Vec::new();
    let mut chunk = [0; 8192];
    loop {
        let count = match reader.read(&mut chunk).await {
            Ok(count) => count,
            Err(error) => {
                tracing::debug!(%error, "prefix capture reader closed");
                return output;
            }
        };
        if count == 0 || output.len() >= limit {
            return output;
        }
        output.extend_from_slice(&chunk[..count]);
    }
}
