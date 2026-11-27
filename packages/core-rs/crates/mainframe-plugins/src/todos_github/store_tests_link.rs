use crate::todos_github::store;

use super::{sample_link, setup};

#[tokio::test]
async fn link_insert_read_delete() {
    let h = setup().await;
    assert!(
        store::insert_link(&h.ctx, &sample_link("p1"))
            .await
            .unwrap()
    );
    let read = store::read_link(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(read.owner, "acme");
    assert_eq!(read.repo, "widgets");
    assert_eq!(read.last_synced_at, None);

    let mut other = sample_link("p1");
    other.repo = "gadgets".to_string();
    assert!(
        !store::insert_link(&h.ctx, &other).await.unwrap(),
        "a project links to one repo; a second insert is refused"
    );
    let read = store::read_link(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(read.repo, "widgets");

    store::delete_link(&h.ctx, "p1").await.unwrap();
    assert!(store::read_link(&h.ctx, "p1").await.unwrap().is_none());
}

/// A sync that finishes after its link was deleted must neither bring the
/// link back nor leave a report of the unlinked repo behind.
#[tokio::test]
async fn a_run_finishing_after_its_link_was_deleted_writes_nothing() {
    let h = setup().await;
    store::insert_link(&h.ctx, &sample_link("p1"))
        .await
        .unwrap();
    let run = store::Run {
        id: "run-1".to_string(),
        project_id: "p1".to_string(),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        finished_at: "2026-01-01T00:00:05Z".to_string(),
        pairs_reconciled: 0,
        reached: 0,
        total: 0,
        failure_kind: None,
        failure_message: None,
    };
    assert!(store::finish_run(&h.ctx, &run, &[], 10).await.unwrap());
    assert_eq!(
        store::read_link(&h.ctx, "p1")
            .await
            .unwrap()
            .unwrap()
            .last_synced_at
            .as_deref(),
        Some("2026-01-01T00:00:05Z")
    );

    store::delete_link(&h.ctx, "p1").await.unwrap();
    let late = store::Run {
        id: "run-2".to_string(),
        ..run
    };
    assert!(!store::finish_run(&h.ctx, &late, &[], 10).await.unwrap());
    assert!(store::read_link(&h.ctx, "p1").await.unwrap().is_none());
    assert!(store::latest_run(&h.ctx, "p1").await.unwrap().is_none());
}

#[tokio::test]
async fn link_read_returns_none_when_absent() {
    let h = setup().await;
    assert!(store::read_link(&h.ctx, "missing").await.unwrap().is_none());
}
