use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::ChildStdin,
    sync::mpsc::{self, UnboundedSender},
    task::JoinHandle,
};

pub fn spawn_stdin_writer(stdin: Option<ChildStdin>) -> UnboundedSender<Vec<u8>> {
    let (sender, mut receiver) = mpsc::unbounded_channel::<Vec<u8>>();
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
    sender
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

pub async fn finish_pumps(pumps: Vec<JoinHandle<()>>) {
    for mut pump in pumps {
        if tokio::time::timeout(std::time::Duration::from_millis(500), &mut pump)
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
