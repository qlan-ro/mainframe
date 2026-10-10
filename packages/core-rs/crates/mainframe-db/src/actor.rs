//! A `Send + Sync` handle to state confined to one dedicated OS thread.
//!
//! rusqlite connections (and `DatabaseManager`, which holds an
//! `Rc<Connection>`) are `!Send`, so they cannot live behind the `Arc`s that
//! axum and tokio tasks share. `SqliteActor` constructs the state on its own
//! worker thread, never moves it off that thread, and serializes every job
//! onto it through an unbounded mpsc channel. The daemon database, every
//! plugin's `data.db` and the automations store each run on one of these.

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

/// Handle to the worker thread that owns `S`. Cloning shares the same worker;
/// the thread exits (dropping `S` and closing the connection) once every
/// handle is gone. Jobs run one at a time in submission order, so a closure
/// sees no interleaving from other callers.
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
    /// Spawns the worker thread (named `mainframe-db`), running `open` on it to
    /// construct the state, and returns a handle once the open succeeds. A
    /// failure inside `open` (bad path, migration error) is surfaced
    /// synchronously.
    pub fn spawn<F>(open: F) -> Result<Self, E>
    where
        F: FnOnce() -> Result<S, E> + Send + 'static,
        E: From<ActorError> + Send + 'static,
    {
        Self::spawn_named("mainframe-db", open)
    }

    /// [`SqliteActor::spawn`] with an explicit thread name.
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
                // Blocking recv is correct here: this is a plain OS thread, not
                // a tokio worker, so blocking it never stalls the runtime.
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

    /// Runs `f` on the worker thread and awaits its result
    /// (`|db| db.chats.list(&pid)`). A dropped worker maps to `E`.
    pub async fn call<F, R>(&self, f: F) -> Result<R, E>
    where
        F: FnOnce(&S) -> Result<R, E> + Send + 'static,
        R: Send + 'static,
    {
        self.call_mut(move |state| f(state)).await
    }

    /// [`SqliteActor::call`] with mutable access to the state, for
    /// `Connection::transaction` and similar `&mut self` APIs.
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

    /// Synchronous sibling of [`SqliteActor::call`]: dispatches `f` onto the
    /// worker thread and **blocks** the caller until the result comes back over
    /// a `std::sync::mpsc` channel. This is the sync-DB bridge that lets the
    /// `ChatManager`'s synchronous `ChatManagerDeps` accessors (`chats_get`,
    /// `chats_update`, …) reach the single WAL connection without opening a
    /// second one; the closure runs on the same thread that owns the state.
    ///
    /// Deadlock rule: the worker is a dedicated OS thread, never a tokio
    /// worker, so blocking a tokio worker here cannot starve the actor. It
    /// must **never** be called from inside a job already running on the
    /// worker thread (the thread would wait on itself forever); every
    /// `ChatManagerDeps` caller runs on a tokio task, so that holds today.
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
