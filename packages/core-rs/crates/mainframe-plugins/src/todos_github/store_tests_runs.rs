use mainframe_types::time::now_iso8601;

use crate::db_context::test_sql::{RawSql as _, text};
use crate::todos_github::store::{self, ReportRow, Run as StoreRun};

use super::{sample_link, setup};

#[tokio::test]
async fn run_and_report_rows_insert_and_read() {
    let h = setup().await;
    store::insert_link(&h.ctx, &sample_link("p1"))
        .await
        .unwrap();
    let run = StoreRun {
        id: "run-1".to_string(),
        project_id: "p1".to_string(),
        started_at: now_iso8601(),
        finished_at: now_iso8601(),
        pairs_reconciled: 2,
        reached: 2,
        total: 2,
        failure_kind: None,
        failure_message: None,
    };
    let row = ReportRow {
        id: "row-1".to_string(),
        run_id: "run-1".to_string(),
        todo_id: "todo-1".to_string(),
        todo_number: 1,
        todo_title: "Title".to_string(),
        issue_number: 7,
        field: "title".to_string(),
        winner: "github".to_string(),
        rule: "recency".to_string(),
        local_at: Some(now_iso8601()),
        remote_at: Some(now_iso8601()),
        remote_coarse: false,
        winning_value: "New title".to_string(),
        replaced_value: "Old title".to_string(),
    };
    assert!(store::finish_run(&h.ctx, &run, &[row], 10).await.unwrap());

    let latest = store::latest_run(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(latest.id, "run-1");

    let rows = store::read_report(&h.ctx, "run-1").await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].winning_value, "New title");
}

#[tokio::test]
async fn eleven_runs_prune_to_ten() {
    let h = setup().await;
    store::insert_link(&h.ctx, &sample_link("p1"))
        .await
        .unwrap();
    for i in 0..11 {
        let run = StoreRun {
            id: format!("run-{i}"),
            project_id: "p1".to_string(),
            started_at: now_iso8601(),
            finished_at: now_iso8601(),
            pairs_reconciled: 0,
            reached: 0,
            total: 0,
            failure_kind: None,
            failure_message: None,
        };
        store::finish_run(&h.ctx, &run, &[], 10).await.unwrap();
    }
    let rows = h
        .ctx
        .raw_query_all(
            "SELECT id FROM github_runs WHERE project_id = ?",
            vec![text("p1".to_string())],
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 10);
    let ids: Vec<String> = rows
        .into_iter()
        .filter_map(|r| r.get("id").and_then(|v| v.as_str().map(str::to_string)))
        .collect();
    assert!(
        !ids.contains(&"run-0".to_string()),
        "the oldest run is pruned"
    );
    assert!(ids.contains(&"run-10".to_string()));
}
