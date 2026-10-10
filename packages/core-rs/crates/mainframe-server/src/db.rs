pub type Db = mainframe_db::actor::SqliteActor<mainframe_db::DatabaseManager>;

#[cfg(test)]
mod tests {
    use super::Db;
    use mainframe_db::DatabaseManager;

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
    async fn call_blocking_bridges_a_sync_call_onto_the_actor() {
        // The SYNC-DB BRIDGE the ChatManagerDeps accessors use: a synchronous call
        // dispatched onto the actor thread, blocking the caller for the result.
        // Runs under the current-thread runtime and does not deadlock because the
        // DB worker is a separate OS thread.
        let db = open_in_memory();
        let created = db
            .call_blocking(|d| d.projects.create("/tmp/sync-bridge", Some("Sync")))
            .unwrap();
        let id = created.id.clone();
        let fetched = db.call_blocking(move |d| d.projects.get(&id)).unwrap();
        assert_eq!(
            fetched.map(|p| p.path),
            Some("/tmp/sync-bridge".to_string())
        );
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
