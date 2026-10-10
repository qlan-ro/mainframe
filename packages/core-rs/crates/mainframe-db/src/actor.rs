use tokio::sync::{mpsc, oneshot};

use crate::DbError;

type Job<S> = Box<dyn FnOnce(&mut S) + Send>;

#[derive(Debug, thiserror::Error)]
pub enum ActorError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("database worker {0}")]
    Worker(&'static str),
}

impl From<ActorError> for DbError {
    fn from(error: ActorError) -> Self {
        match error {
            ActorError::Io(error) => Self::Io(error),
            other => Self::Message(other.to_string()),
        }
    }
}

pub struct SqliteActor<S, E = DbError> {
    tx: mpsc::UnboundedSender<Job<S>>,
    error: std::marker::PhantomData<fn() -> E>,
}

impl<S, E> Clone for SqliteActor<S, E> {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            error: std::marker::PhantomData,
        }
    }
}

impl<S: 'static, E: From<ActorError> + Send + 'static> SqliteActor<S, E> {
    pub fn spawn<F>(open: F) -> Result<Self, E>
    where
        F: FnOnce() -> Result<S, E> + Send + 'static,
        E: From<ActorError> + Send + 'static,
    {
        Self::spawn_named("mainframe-db", open)
    }

    pub fn spawn_named<F>(name: &str, open: F) -> Result<Self, E>
    where
        F: FnOnce() -> Result<S, E> + Send + 'static,
        E: From<ActorError> + Send + 'static,
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<Job<S>>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name(name.into())
            .spawn(move || {
                let mut state = match open() {
                    Ok(state) => state,
                    Err(error) => {
                        let _ = ready_tx.send(Err(error)); // Receiver may have gone away.
                        return;
                    }
                };
                if ready_tx.send(Ok(())).is_err() {
                    return;
                }
                while let Some(job) = rx.blocking_recv() {
                    job(&mut state);
                }
            })
            .map_err(ActorError::Io)?;
        ready_rx
            .recv()
            .map_err(|_| ActorError::Worker("failed to start"))??;
        Ok(Self {
            tx,
            error: std::marker::PhantomData,
        })
    }

    pub async fn call<F, R>(&self, f: F) -> Result<R, E>
    where
        F: FnOnce(&S) -> Result<R, E> + Send + 'static,
        R: Send + 'static,
    {
        self.call_mut(move |state| f(state)).await
    }

    pub async fn call_mut<F, R>(&self, f: F) -> Result<R, E>
    where
        F: FnOnce(&mut S) -> Result<R, E> + Send + 'static,
        R: Send + 'static,
        E: From<ActorError> + Send + 'static,
    {
        let (tx, rx) = oneshot::channel();
        self.submit(Box::new(move |state| {
            let _ = tx.send(f(state)); // Cancellation does not cancel an accepted write.
        }))?;
        rx.await
            .map_err(|_| ActorError::Worker("dropped the request"))?
    }

    pub fn call_blocking<F, R>(&self, f: F) -> Result<R, E>
    where
        F: FnOnce(&S) -> Result<R, E> + Send + 'static,
        R: Send + 'static,
        E: From<ActorError> + Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel();
        self.submit(Box::new(move |state| {
            let _ = tx.send(f(state)); // The synchronous caller may have gone away.
        }))?;
        rx.recv()
            .map_err(|_| ActorError::Worker("dropped the request"))?
    }

    fn submit(&self, job: Job<S>) -> Result<(), ActorError> {
        self.tx
            .send(job)
            .map_err(|_| ActorError::Worker("unavailable"))
    }
}
