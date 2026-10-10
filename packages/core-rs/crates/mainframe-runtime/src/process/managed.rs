use super::{Signal, Target, signal};
use std::{collections::VecDeque, sync::Arc};
use tokio::{
    process::Child,
    sync::{mpsc, watch},
    task::JoinHandle,
};

/// Resolves once the child has been reaped AND its output pumps have finished
/// (each bounded by [`super::PUMP_DRAIN_GRACE`]), so an exit handler never
/// runs ahead of the child's last stdout/stderr chunk.
#[derive(Clone)]
pub struct ExitLatch(watch::Receiver<Option<Option<i32>>>);

impl ExitLatch {
    pub async fn wait(&self) -> Option<i32> {
        let mut receiver = self.0.clone();
        match receiver.wait_for(Option::is_some).await {
            Ok(value) => (*value).flatten(),
            Err(_) => None,
        }
    }

    pub fn exited(&self) -> bool {
        self.0.borrow().is_some()
    }
}

struct Owner {
    signals: mpsc::UnboundedSender<Signal>,
}

impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.signals.send(Signal::Kill); /* expected: owner already exited */
    }
}

#[derive(Clone)]
pub struct ManagedProcess {
    owner: Arc<Owner>,
    exit: ExitLatch,
}

impl ManagedProcess {
    pub fn spawn(child: Child, pumps: Vec<JoinHandle<()>>) -> Self {
        let (signals, receiver) = mpsc::unbounded_channel();
        let (exit, state) = watch::channel(None);
        tokio::spawn(watch_child(child, receiver, exit, pumps));
        Self {
            owner: Arc::new(Owner { signals }),
            exit: ExitLatch(state),
        }
    }

    pub fn signal(&self, signal: Signal) {
        let _ = self.owner.signals.send(signal); /* expected: owner already exited */
    }

    pub fn exit(&self) -> ExitLatch {
        self.exit.clone()
    }
}

async fn watch_child(
    mut child: Child,
    mut signals: mpsc::UnboundedReceiver<Signal>,
    exit: watch::Sender<Option<Option<i32>>>,
    pumps: Vec<JoinHandle<()>>,
) {
    let status = loop {
        tokio::select! {
            status = child.wait() => break status,
            Some(kind) = signals.recv() => {
                match child.try_wait() {
                    Ok(Some(status)) => break Ok(status),
                    Ok(None) => {
                        if let Some(pid) = child.id()
                            && let Err(error) = signal(Target::Pid(pid), kind)
                        {
                            tracing::warn!(pid, %error, "child signal failed");
                        }
                    }
                    Err(error) => tracing::warn!(%error, "child status check failed"),
                }
            }
        }
    };
    let code = match status {
        Ok(status) => status.code(),
        Err(error) => {
            tracing::warn!(%error, "child wait failed");
            None
        }
    };
    super::finish_pumps(pumps).await;
    exit.send_replace(Some(code));
}

pub struct TailBuffer {
    lines: VecDeque<String>,
    capacity: usize,
}

impl TailBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            lines: VecDeque::new(),
            capacity,
        }
    }
    pub fn push(&mut self, line: String) {
        if self.capacity == 0 {
            return;
        }
        if self.lines.len() == self.capacity {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = &String> {
        self.lines.iter()
    }
}
