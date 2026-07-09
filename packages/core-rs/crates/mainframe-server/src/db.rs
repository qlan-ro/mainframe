//! The Send+Sync database handle backing `AppCtx.db`.
//!
//! `mainframe_db::DatabaseManager` owns an `Rc<rusqlite::Connection>` and is
//! therefore `!Send` — it cannot live behind the `Arc<AppCtx>` that axum shares
//! across worker tasks. Per CONCURRENCY.tsv (`db/index.ts` → class `DB`:
//! "single rusqlite Connection, WAL, all queries via spawn_blocking; repositories
//! borrow the shared handle") the connection is confined to one dedicated thread
//! and every query is serialized onto it. The db crate deferred this wrapper
//! ("Async wrapping is a later phase"); it lands here, in its sole consumer.
//!
//! The handle (`Db`) holds a `tokio::mpsc::UnboundedSender<Job>`, which is
//! `Send + Sync + Clone`; the `DatabaseManager` is constructed on, and never
//! leaves, the worker thread. `call` ships an `FnOnce(&DatabaseManager)` closure
//! and awaits its result over a oneshot.

use mainframe_db::{DatabaseManager, DbError};
use tokio::sync::{mpsc, oneshot};

type Job = Box<dyn FnOnce(&DatabaseManager) + Send>;

/// Send+Sync handle to the single-threaded `DatabaseManager`.
#[derive(Clone)]
pub struct Db {
    tx: mpsc::UnboundedSender<Job>,
}

impl Db {
    /// Spawns the DB worker thread, running `open` on it to construct the
    /// `DatabaseManager`, and returns a handle once the open succeeds. A failure
    /// inside `open` (bad path, migration error) is surfaced synchronously.
    pub fn spawn<F>(open: F) -> Result<Self, DbError>
    where
        F: FnOnce() -> Result<DatabaseManager, DbError> + Send + 'static,
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<Job>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), DbError>>();

        std::thread::Builder::new()
            .name("mainframe-db".into())
            .spawn(move || {
                let db = match open() {
                    Ok(db) => {
                        // If the handle was already dropped the send fails; the
                        // thread then just exits (db drops, connection closes).
                        if ready_tx.send(Ok(())).is_err() {
                            return;
                        }
                        db
                    }
                    Err(err) => {
                        let _ = ready_tx.send(Err(err));
                        return;
                    }
                };
                // Blocking recv is correct here: this is a plain OS thread, not a
                // tokio worker, so blocking it never stalls the runtime.
                while let Some(job) = rx.blocking_recv() {
                    job(&db);
                }
            })
            .map_err(DbError::Io)?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { tx }),
            Ok(Err(err)) => Err(err),
            Err(_) => Err(DbError::Message("database worker failed to start".into())),
        }
    }

    /// Runs `f` on the DB thread and awaits its `Result`. The closure receives a
    /// shared `&DatabaseManager`, so all six repositories are reachable
    /// (`|db| db.chats.list(&pid)`). A dropped worker maps to a `DbError`.
    pub async fn call<F, R>(&self, f: F) -> Result<R, DbError>
    where
        F: FnOnce(&DatabaseManager) -> Result<R, DbError> + Send + 'static,
        R: Send + 'static,
    {
        let (res_tx, res_rx) = oneshot::channel::<Result<R, DbError>>();
        let job: Job = Box::new(move |db| {
            let _ = res_tx.send(f(db));
        });
        self.tx
            .send(job)
            .map_err(|_| DbError::Message("database worker unavailable".into()))?;
        match res_rx.await {
            Ok(result) => result,
            Err(_) => Err(DbError::Message(
                "database worker dropped the request".into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Db {
        Db::spawn(|| DatabaseManager::open(std::path::Path::new(":memory:"))).unwrap()
    }

    #[tokio::test]
    async fn call_runs_closure_on_the_db_thread_and_returns_result() {
        let db = open_in_memory();
        let project = db
            .call(|d| d.projects.create("/tmp/example-proj", Some("Example")))
            .await
            .unwrap();
        let fetched = db.call(move |d| d.projects.get(&project.id)).await.unwrap();
        assert!(fetched.is_some());
    }

    #[tokio::test]
    async fn spawn_surfaces_open_errors() {
        // An unwriteable path makes DatabaseManager::open fail; spawn returns Err.
        let result = Db::spawn(|| {
            DatabaseManager::open(std::path::Path::new(
                "/nonexistent-dir-xyz/nested/mainframe.db",
            ))
        });
        assert!(result.is_err());
    }
}

// PORT STATUS: (new — realizes CONCURRENCY.tsv class DB for db/index.ts)
// confidence: high
// todos: 0
// notes: DatabaseManager is !Send (Rc<Connection>); this actor confines it to a
// dedicated thread and serializes access, matching better-sqlite3's
// single-threaded semantics and the tsv's "single connection / spawn_blocking"
// directive. `mpsc::UnboundedSender` is Send+Sync+Clone so `Db` (and therefore
// AppCtx) is Send+Sync. Worker-death folds into DbError so route handlers keep a
// single `?`. Open errors surface synchronously via a std oneshot.
