//! Task 42: the acceptance suite (todo #286) — one test per remaining spec
//! criterion, driving the real `/todos/github` routes end-to-end against
//! `FakeGitHub` and asserting on its recorded calls or the persisted state,
//! never on internal call sequences.
//!
//! AC9 (renumbering keeps the pair keyed on `todo_id`), AC23 (report
//! retention), AC28 (the workflow-label list is declared once), AC30
//! (a rate-limited response is not retried), AC31 (the migration is
//! additive), and AC35 (a second sync while one runs is refused) already
//! have exact-granularity tests elsewhere in this tree —
//! `store_tests.rs::renumbering_keeps_the_pair_keyed_on_todo_id`,
//! `store_tests.rs::eleven_runs_prune_to_ten` and
//! `run_failure_tests.rs::eleven_runs_leave_exactly_ten_reports`,
//! `labels_tests.rs::workflow_label_list_is_declared_exactly_once`,
//! `run_failure_tests.rs::a_rate_limited_error_stops_the_run_and_preserves_already_written_baselines`,
//! `store_tests.rs::migration_creates_every_table_on_a_fresh_db` /
//! `migration_is_additive_over_preexisting_todos`, and
//! `routes_tests/sync.rs::post_sync_while_running_returns_409_with_readable_message`
//! — so they are not duplicated here.

mod field_sync;
mod labels_wire;
mod linking;
mod local_recency;
mod no_op_paths;
mod resilience;
mod scope;
mod state_local;
mod state_outbound;
mod state_remote;

use std::collections::HashMap;

use axum::body::to_bytes;
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::Value;

use crate::PluginContext;
use crate::db_context::text;
use crate::github_port::IssuePatch;
use crate::todos_github::fake_github::{Call, FakeGitHub};

async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn qs(pairs: &[(&str, &str)]) -> Query<HashMap<String, String>> {
    Query(
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    )
}

async fn todo_field(ctx: &PluginContext, id: &str, column: &str) -> Option<String> {
    ctx.db
        .query_one(
            format!("SELECT {column} FROM todos WHERE id = ?"),
            vec![text(id.to_string())],
        )
        .await
        .unwrap()
        .and_then(|row| row.get(column).and_then(Value::as_str).map(str::to_string))
}

fn writes_happened(fake: &FakeGitHub) -> bool {
    fake.calls
        .lock()
        .unwrap()
        .iter()
        .any(|c| matches!(c, Call::CreateIssue(_) | Call::UpdateIssue(_, _)))
}

/// The `IssuePatch` from the most recent `UpdateIssue(number, _)` call —
/// panics if there wasn't one, which every caller has just proven happened.
fn update_patch(fake: &FakeGitHub, number: u64) -> IssuePatch {
    fake.calls
        .lock()
        .unwrap()
        .iter()
        .rev()
        .find_map(|c| match c {
            Call::UpdateIssue(n, patch) if *n == number => Some(patch.clone()),
            _ => None,
        })
        .expect("expected an UpdateIssue call for this issue number")
}
