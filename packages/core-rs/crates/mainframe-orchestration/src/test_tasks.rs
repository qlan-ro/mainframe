//! In-memory `TaskStore` for the tool tests.

use mainframe_types::sync::LockExt as _;
use std::sync::{Arc, Mutex};

use mainframe_types::orchestration::DelegatedTask;

use crate::errors::PortError;
use crate::ports::{BoxFuture, TaskStore};

#[derive(Clone, Default)]
pub struct FakeTasks {
    pub rows: Arc<Mutex<Vec<DelegatedTask>>>,
}

impl FakeTasks {
    pub fn all(&self) -> Vec<DelegatedTask> {
        self.rows.lock_recover().clone()
    }

    pub fn find(&self, id: &str) -> Option<DelegatedTask> {
        self.all().into_iter().find(|t| t.id == id)
    }

    fn select(&self, f: impl Fn(&DelegatedTask) -> bool) -> Vec<DelegatedTask> {
        self.all().into_iter().filter(|t| f(t)).collect()
    }
}

impl TaskStore for FakeTasks {
    fn insert(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>> {
        Box::pin(async move {
            self.rows.lock_recover().push(task);
            Ok(())
        })
    }

    fn update(&self, task: DelegatedTask) -> BoxFuture<'_, Result<(), PortError>> {
        Box::pin(async move {
            let mut rows = self.rows.lock_recover();
            if let Some(row) = rows.iter_mut().find(|t| t.id == task.id) {
                *row = task;
            }
            Ok(())
        })
    }

    fn get<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, Option<DelegatedTask>> {
        Box::pin(async move { self.find(task_id) })
    }

    fn by_child<'a>(&'a self, child: &'a str) -> BoxFuture<'a, Option<DelegatedTask>> {
        Box::pin(async move { self.select(|t| t.child_chat_id == child).into_iter().next() })
    }

    fn by_request<'a>(
        &'a self,
        parent: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, Option<DelegatedTask>> {
        Box::pin(async move {
            self.select(|t| {
                t.parent_chat_id == parent && t.client_request_id.as_deref() == Some(key)
            })
            .into_iter()
            .next()
        })
    }

    fn by_parent<'a>(&'a self, parent: &'a str, limit: u32) -> BoxFuture<'a, Vec<DelegatedTask>> {
        Box::pin(async move {
            let mut rows = self.select(|t| t.parent_chat_id == parent);
            rows.reverse();
            rows.truncate(limit as usize);
            rows
        })
    }

    fn nonterminal(&self) -> BoxFuture<'_, Vec<DelegatedTask>> {
        Box::pin(async move { self.select(|t| !t.status.is_terminal()) })
    }

    fn owed(&self) -> BoxFuture<'_, Vec<DelegatedTask>> {
        Box::pin(async move {
            use mainframe_types::orchestration::TaskDelivery;
            self.select(|t| t.delivery == TaskDelivery::Owed)
        })
    }

    fn interrupt_unfinished(&self) -> BoxFuture<'_, usize> {
        Box::pin(async move {
            use mainframe_types::orchestration::{TaskDelivery, TaskStatus};
            let mut rows = self.rows.lock_recover();
            let mut n = 0;
            for row in rows.iter_mut().filter(|t| !t.status.is_terminal()) {
                row.status = TaskStatus::Interrupted;
                row.delivery = TaskDelivery::Dropped;
                n += 1;
            }
            n
        })
    }
}
