//! `TaskStore` over the DB actor's `delegated_tasks` repository.

use mainframe_db::DbError;
use mainframe_orchestration::errors::PortError;
use mainframe_orchestration::ports::{BoxFuture, TaskStore};
use mainframe_types::orchestration::DelegatedTask;
use mainframe_types::time::now_iso8601;

use crate::db::Db;

pub struct DbTaskStore {
    db: Db,
}

impl DbTaskStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    async fn call<T, F>(&self, f: F) -> Result<T, PortError>
    where
        T: Send + 'static,
        F: FnOnce(&mainframe_db::DatabaseManager) -> Result<T, DbError> + Send + 'static,
    {
        self.db.call(f).await.map_err(internal)
    }
}

fn internal(err: DbError) -> PortError {
    PortError::Internal(format!("delegated_tasks: {err}"))
}

impl TaskStore for DbTaskStore {
    fn insert(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>> {
        Box::pin(self.call(move |d| d.delegated_tasks.insert(&task)))
    }

    fn update(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>> {
        Box::pin(self.call(move |d| d.delegated_tasks.update(&task)))
    }

    fn get<'a>(
        &'a self,
        task_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<DelegatedTask>, PortError>> {
        let id = task_id.to_string();
        Box::pin(self.call(move |d| d.delegated_tasks.get(&id)))
    }

    fn by_child<'a>(
        &'a self,
        child_chat_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<DelegatedTask>, PortError>> {
        let id = child_chat_id.to_string();
        Box::pin(self.call(move |d| d.delegated_tasks.get_by_child(&id)))
    }

    fn by_request<'a>(
        &'a self,
        parent_chat_id: &'a str,
        client_request_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<DelegatedTask>, PortError>> {
        let (parent, key) = (parent_chat_id.to_string(), client_request_id.to_string());
        Box::pin(self.call(move |d| d.delegated_tasks.find_by_request(&parent, &key)))
    }

    fn by_parent<'a>(
        &'a self,
        parent_chat_id: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Result<Vec<DelegatedTask>, PortError>> {
        let parent = parent_chat_id.to_string();
        Box::pin(self.call(move |d| d.delegated_tasks.list_by_parent(&parent, limit)))
    }

    fn nonterminal(&self) -> BoxFuture<'_, Result<Vec<DelegatedTask>, PortError>> {
        Box::pin(self.call(|d| d.delegated_tasks.list_nonterminal()))
    }

    fn owed(&self) -> BoxFuture<'_, Result<Vec<DelegatedTask>, PortError>> {
        Box::pin(self.call(|d| d.delegated_tasks.list_owed()))
    }

    fn interrupt_unfinished(&self) -> BoxFuture<'_, Result<usize, PortError>> {
        let now = now_iso8601();
        Box::pin(self.call(move |d| d.delegated_tasks.interrupt_unfinished(&now)))
    }
}
