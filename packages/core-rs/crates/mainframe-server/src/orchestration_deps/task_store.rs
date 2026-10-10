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

    /// A read that cannot fail the caller: a DB error is logged and reads as
    /// "nothing there".
    async fn read<T, F>(&self, what: &'static str, f: F) -> T
    where
        T: Default + Send + 'static,
        F: FnOnce(&mainframe_db::DatabaseManager) -> Result<T, DbError> + Send + 'static,
    {
        match self.db.call(f).await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(what, %err, "delegated task read failed");
                T::default()
            }
        }
    }
}

fn internal(err: DbError) -> PortError {
    PortError::Internal(format!("delegated_tasks: {err}"))
}

impl TaskStore for DbTaskStore {
    fn insert(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>> {
        Box::pin(async move {
            self.db
                .call(move |d| d.delegated_tasks.insert(&task))
                .await
                .map_err(internal)
        })
    }

    fn update(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>> {
        Box::pin(async move {
            self.db
                .call(move |d| d.delegated_tasks.update(&task))
                .await
                .map_err(internal)
        })
    }

    fn get<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, Option<DelegatedTask>> {
        let id = task_id.to_string();
        Box::pin(self.read("get", move |d| d.delegated_tasks.get(&id)))
    }

    fn by_child<'a>(&'a self, child_chat_id: &'a str) -> BoxFuture<'a, Option<DelegatedTask>> {
        let id = child_chat_id.to_string();
        Box::pin(self.read("by_child", move |d| d.delegated_tasks.get_by_child(&id)))
    }

    fn by_request<'a>(
        &'a self,
        parent_chat_id: &'a str,
        client_request_id: &'a str,
    ) -> BoxFuture<'a, Option<DelegatedTask>> {
        let (parent, key) = (parent_chat_id.to_string(), client_request_id.to_string());
        Box::pin(self.read("by_request", move |d| {
            d.delegated_tasks.find_by_request(&parent, &key)
        }))
    }

    fn by_parent<'a>(
        &'a self,
        parent_chat_id: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, Vec<DelegatedTask>> {
        let parent = parent_chat_id.to_string();
        Box::pin(self.read("by_parent", move |d| {
            d.delegated_tasks.list_by_parent(&parent, limit)
        }))
    }

    fn nonterminal(&self) -> BoxFuture<'_, Vec<DelegatedTask>> {
        Box::pin(self.read("nonterminal", |d| d.delegated_tasks.list_nonterminal()))
    }

    fn owed(&self) -> BoxFuture<'_, Vec<DelegatedTask>> {
        Box::pin(self.read("owed", |d| d.delegated_tasks.list_owed()))
    }

    fn interrupt_unfinished(&self) -> BoxFuture<'_, usize> {
        let now = now_iso8601();
        Box::pin(self.read("interrupt_unfinished", move |d| {
            d.delegated_tasks.interrupt_unfinished(&now)
        }))
    }
}
