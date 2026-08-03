use crate::todos_github::store;

use super::{sample_link, setup};

#[tokio::test]
async fn link_upsert_read_delete() {
    let h = setup().await;
    store::insert_link(&h.ctx, &sample_link("p1"))
        .await
        .unwrap();
    let read = store::read_link(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(read.owner, "acme");
    assert_eq!(read.repo, "widgets");
    assert_eq!(read.last_synced_at, None);

    let mut updated = sample_link("p1");
    updated.repo = "gadgets".to_string();
    store::insert_link(&h.ctx, &updated).await.unwrap();
    let read = store::read_link(&h.ctx, "p1").await.unwrap().unwrap();
    assert_eq!(
        read.repo, "gadgets",
        "a second insert upserts the single row"
    );

    store::delete_link(&h.ctx, "p1").await.unwrap();
    assert!(store::read_link(&h.ctx, "p1").await.unwrap().is_none());
}

#[tokio::test]
async fn link_read_returns_none_when_absent() {
    let h = setup().await;
    assert!(store::read_link(&h.ctx, "missing").await.unwrap().is_none());
}
