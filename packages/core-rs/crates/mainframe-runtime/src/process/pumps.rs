use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::ChildStdin,
    sync::mpsc,
    task::JoinHandle,
};

/// Queued stdin writes a child may fall behind on before the daemon stops
/// buffering. Generous for line-oriented protocols (one entry per message);
/// bounded so a stalled child cannot grow the queue without limit.
pub const STDIN_QUEUE_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum StdinWriteError {
    #[error("child stdin closed")]
    Closed,
    #[error("child stdin queue full")]
    Full,
}

/// Handle to a child's single stdin writer task. Writes are queued in order;
/// the queue holds [`STDIN_QUEUE_CAPACITY`] entries.
#[derive(Clone, Debug)]
pub struct StdinWriter(mpsc::Sender<Vec<u8>>);

impl StdinWriter {
    /// A writer whose queue drains into `receiver` instead of a child; the
    /// production writer task and tests both consume this end.
    pub fn channel(capacity: usize) -> (Self, mpsc::Receiver<Vec<u8>>) {
        let (sender, receiver) = mpsc::channel(capacity);
        (Self(sender), receiver)
    }

    /// Queue `bytes` without waiting: for synchronous callers. Fails with
    /// [`StdinWriteError::Full`] rather than blocking or buffering past the
    /// capacity.
    pub fn try_write(&self, bytes: Vec<u8>) -> Result<(), StdinWriteError> {
        self.0.try_send(bytes).map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => StdinWriteError::Full,
            mpsc::error::TrySendError::Closed(_) => StdinWriteError::Closed,
        })
    }

    /// Queue `bytes`, waiting for room when the queue is full.
    pub async fn write(&self, bytes: Vec<u8>) -> Result<(), StdinWriteError> {
        self.0
            .send(bytes)
            .await
            .map_err(|_| StdinWriteError::Closed)
    }

    pub fn is_closed(&self) -> bool {
        self.0.is_closed()
    }
}

/// The writer task stops at the first failed write or flush, closing the
/// queue so later writes report [`StdinWriteError::Closed`].
pub fn spawn_stdin_writer(stdin: Option<ChildStdin>) -> StdinWriter {
    let (writer, mut receiver) = StdinWriter::channel(STDIN_QUEUE_CAPACITY);
    if let Some(mut stdin) = stdin {
        tokio::spawn(async move {
            while let Some(bytes) = receiver.recv().await {
                if let Err(error) = stdin.write_all(&bytes).await {
                    tracing::debug!(%error, "child stdin closed");
                    break;
                }
                if let Err(error) = stdin.flush().await {
                    tracing::debug!(%error, "child stdin flush failed");
                    break;
                }
            }
        });
    }
    writer
}

pub fn spawn_line_pump<R, F>(reader: R, mut on_line: F) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    F: FnMut(String) + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => on_line(line),
                Ok(None) => break,
                Err(error) => {
                    tracing::debug!(%error, "child line reader closed");
                    break;
                }
            }
        }
    })
}

pub fn spawn_chunk_pump<R, F>(mut reader: R, mut on_chunk: F) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    F: FnMut(&[u8]) -> bool + Send + 'static,
{
    tokio::spawn(async move {
        let mut bytes = [0; 8192];
        loop {
            match reader.read(&mut bytes).await {
                Ok(0) => break,
                Ok(count) if !on_chunk(&bytes[..count]) => break,
                Ok(_) => {}
                Err(error) => {
                    tracing::debug!(%error, "child chunk reader closed");
                    break;
                }
            }
        }
    })
}

/// How long an output pump may keep reading after its child exited before it
/// is abandoned: a grandchild that inherited the pipe must not hold the exit.
pub const PUMP_DRAIN_GRACE: std::time::Duration = std::time::Duration::from_millis(500);

pub async fn finish_pumps(pumps: Vec<JoinHandle<()>>) {
    for mut pump in pumps {
        if tokio::time::timeout(PUMP_DRAIN_GRACE, &mut pump)
            .await
            .is_err()
        {
            pump.abort();
        }
    }
}

pub struct PumpTasks(Vec<JoinHandle<()>>);

impl PumpTasks {
    pub fn new(tasks: Vec<JoinHandle<()>>) -> Self {
        Self(tasks)
    }
    pub async fn finish(mut self) {
        finish_pumps(std::mem::take(&mut self.0)).await;
    }
}

impl Drop for PumpTasks {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}
