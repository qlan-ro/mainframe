//! Store-level tests for the todos-github plugin (todo #286): schema
//! migrations, and the `Link`/`Pair`/`Run` CRUD surfaces. Split by table
//! group to stay under the 300-line file cap (finding #13); this module
//! holds the shared harness/fixture helpers.

mod link;
mod migrations;
mod pairs;
mod runs;

use mainframe_runtime::time::now_iso8601;

use crate::todos;
use crate::todos_github::schema::run_github_migrations;
use crate::todos_github::store::{Link, Pair};

/// A fresh todos+github db, migrated for both plugin surfaces.
async fn setup() -> todos::tests::Harness {
    let h = todos::tests::setup().await;
    run_github_migrations(&h.ctx).await.unwrap();
    h
}

fn sample_link(project_id: &str) -> Link {
    Link {
        project_id: project_id.to_string(),
        owner: "acme".to_string(),
        repo: "widgets".to_string(),
        remote_name: "origin".to_string(),
        credential_label: "github".to_string(),
        last_synced_at: None,
        created_at: now_iso8601(),
    }
}

fn sample_pair(todo_id: &str, project_id: &str, issue_number: i64) -> Pair {
    Pair {
        todo_id: todo_id.to_string(),
        project_id: project_id.to_string(),
        owner: "acme".to_string(),
        repo: "widgets".to_string(),
        issue_number,
        issue_url: format!("https://github.com/acme/widgets/issues/{issue_number}"),
        pair_state: "clean".to_string(),
        state_reason: None,
        base_title: "Title".to_string(),
        base_body: "Body".to_string(),
        base_state: "open".to_string(),
        base_labels: vec!["bug".to_string()],
        base_at: now_iso8601(),
        created_at: now_iso8601(),
    }
}
