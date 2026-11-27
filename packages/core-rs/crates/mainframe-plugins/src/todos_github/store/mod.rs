//! CRUD for the GitHub sync tables: the project↔repo link, the todo↔issue
//! pairs (with their 3-way-diff baseline), and sync-run history. Rows are
//! read through `FromRow`, so a missing or mistyped column is an error rather
//! than an empty value.

mod link;
mod pairs;
mod runs;

pub(crate) use link::{Link, delete_link, insert_link, read_link};
pub(crate) use pairs::{
    Pair, PairState, delete_pair, insert_pair, insert_pair_in, paired_todo_numbers,
    pairs_for_project, pairs_with_todo_numbers, read_pair_by_issue, read_pair_by_todo,
    set_pair_state, set_pair_state_in, write_baseline_in,
};
pub(crate) use runs::{
    ReportRow, Run, finish_run, latest_run, prune_runs_in, read_report, read_run,
};
