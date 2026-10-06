//! `delegated_tasks` (migration 32): one row per child chat an agent
//! delegated a task to. Lineage kind is derived from this table on read: a
//! row here makes a child `delegated`; otherwise `temporary = 1` is a side
//! chat and any other child a fork.

use std::collections::HashMap;
use std::rc::Rc;

use mainframe_types::orchestration::{DelegatedTask, TaskDelivery, TaskRole, TaskStatus};
use rusqlite::{Connection, Row};

use crate::DbError;

const SELECT: &str = "SELECT id, parent_chat_id, child_chat_id, client_request_id, title, role, \
     status, depth, summary, error, cancel_reason, delivery, created_at, updated_at, completed_at \
     FROM delegated_tasks";

#[derive(Clone)]
pub struct DelegatedTasksRepository {
    db: Rc<Connection>,
}

fn parse<T>(raw: String, f: fn(&str) -> Option<T>) -> rusqlite::Result<T> {
    f(&raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown delegated task value {raw}").into(),
        )
    })
}

fn row_to_task(row: &Row<'_>) -> rusqlite::Result<DelegatedTask> {
    Ok(DelegatedTask {
        id: row.get(0)?,
        parent_chat_id: row.get(1)?,
        child_chat_id: row.get(2)?,
        client_request_id: row.get(3)?,
        title: row.get(4)?,
        role: parse(row.get(5)?, TaskRole::parse)?,
        status: parse(row.get(6)?, TaskStatus::parse)?,
        depth: row.get(7)?,
        summary: row.get(8)?,
        error: row.get(9)?,
        cancel_reason: row.get(10)?,
        delivery: parse(row.get(11)?, TaskDelivery::parse)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        completed_at: row.get(14)?,
    })
}

impl DelegatedTasksRepository {
    #[must_use]
    pub fn new(db: Rc<Connection>) -> Self {
        Self { db }
    }

    pub fn insert(&self, task: &DelegatedTask) -> Result<(), DbError> {
        self.db.execute(
            "INSERT INTO delegated_tasks (id, parent_chat_id, child_chat_id, client_request_id, \
             title, role, status, depth, summary, error, cancel_reason, delivery, created_at, \
             updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                task.id,
                task.parent_chat_id,
                task.child_chat_id,
                task.client_request_id,
                task.title,
                task.role.as_str(),
                task.status.as_str(),
                task.depth,
                task.summary,
                task.error,
                task.cancel_reason,
                task.delivery.as_str(),
                task.created_at,
                task.updated_at,
                task.completed_at,
            ],
        )?;
        Ok(())
    }

    /// Writes every mutable column of `task`.
    pub fn update(&self, task: &DelegatedTask) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE delegated_tasks SET status = ?, summary = ?, error = ?, cancel_reason = ?, \
             delivery = ?, updated_at = ?, completed_at = ? WHERE id = ?",
            rusqlite::params![
                task.status.as_str(),
                task.summary,
                task.error,
                task.cancel_reason,
                task.delivery.as_str(),
                task.updated_at,
                task.completed_at,
                task.id,
            ],
        )?;
        Ok(())
    }

    fn query(
        &self,
        clause: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Result<Vec<DelegatedTask>, DbError> {
        let mut stmt = self.db.prepare(&format!("{SELECT} {clause}"))?;
        let rows = stmt.query_map(params, row_to_task)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get(&self, id: &str) -> Result<Option<DelegatedTask>, DbError> {
        Ok(self.query("WHERE id = ?", &[&id])?.into_iter().next())
    }

    pub fn get_by_child(&self, child_chat_id: &str) -> Result<Option<DelegatedTask>, DbError> {
        Ok(self
            .query("WHERE child_chat_id = ?", &[&child_chat_id])?
            .into_iter()
            .next())
    }

    pub fn find_by_request(
        &self,
        parent_chat_id: &str,
        client_request_id: &str,
    ) -> Result<Option<DelegatedTask>, DbError> {
        Ok(self
            .query(
                "WHERE parent_chat_id = ? AND client_request_id = ?",
                &[&parent_chat_id, &client_request_id],
            )?
            .into_iter()
            .next())
    }

    /// The parent's tasks, newest first.
    pub fn list_by_parent(
        &self,
        parent_chat_id: &str,
        limit: u32,
    ) -> Result<Vec<DelegatedTask>, DbError> {
        self.query(
            "WHERE parent_chat_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            &[&parent_chat_id, &limit],
        )
    }

    pub fn list_nonterminal(&self) -> Result<Vec<DelegatedTask>, DbError> {
        self.query("WHERE status IN ('queued', 'running', 'waiting')", &[])
    }

    pub fn list_owed(&self) -> Result<Vec<DelegatedTask>, DbError> {
        self.query("WHERE delivery = 'owed' ORDER BY completed_at, id", &[])
    }

    /// `child chat id → task id` for every delegated child in a project.
    pub fn task_ids_in_project(
        &self,
        project_id: &str,
    ) -> Result<HashMap<String, String>, DbError> {
        let mut stmt = self.db.prepare(
            "SELECT t.child_chat_id, t.id FROM delegated_tasks t \
             JOIN chats c ON c.id = t.child_chat_id WHERE c.project_id = ?",
        )?;
        let rows = stmt.query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
    }

    /// Boot: the CLIs died with the previous daemon, so no live task can
    /// still finish. Returns how many were interrupted.
    pub fn interrupt_unfinished(&self, now: &str) -> Result<usize, DbError> {
        Ok(self.db.execute(
            "UPDATE delegated_tasks SET status = 'interrupted', delivery = 'dropped', \
             error = COALESCE(error, 'The daemon restarted before the task finished.'), \
             updated_at = ?1, completed_at = ?1 \
             WHERE status IN ('queued', 'running', 'waiting')",
            [now],
        )?)
    }
}
