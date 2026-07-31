//! CRUD for the GitHub sync tables (todo #286): the project↔repo link, the
//! todo↔issue pairs (with their 3-way-diff baseline), and sync-run history.
//! Split per table to stay under 300 lines each; the row column-reading
//! helpers below are shared by all three.

mod link;
mod pairs;
mod runs;

pub use link::{Link, delete_link, insert_link, read_link};
pub use pairs::{
    Pair, delete_pair, insert_pair, pairs_for_project, read_pair_by_issue, read_pair_by_todo,
    set_pair_state, write_baseline,
};
pub use runs::{
    ReportRow, Run, insert_report_rows, insert_run, latest_run, prune_runs, read_report,
};

use serde_json::Value;

use crate::db_context::Row;

fn col_str(row: &Row, key: &str) -> String {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn col_opt_str(row: &Row, key: &str) -> Option<String> {
    row.get(key).and_then(Value::as_str).map(str::to_string)
}

fn col_i64(row: &Row, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn col_bool(row: &Row, key: &str) -> bool {
    col_i64(row, key) != 0
}
