//! T7 — webhook delivery state. The sample index is in-memory (R3); this row
//! is the one webhook fact that has to outlive a daemon restart, because the
//! editor's "last delivery" line is how a user tells a wired-up hook from a
//! silent one.

use tempfile::TempDir;

use super::db::AutomationDb;
use super::webhook_state::WebhookStateStore;

#[tokio::test]
async fn a_delivery_time_is_upserted_and_survives_a_reopen() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("automations.db");

    let store = WebhookStateStore::new(AutomationDb::open(&path).await.unwrap());
    assert_eq!(store.last_delivery_at("hook-1").await.unwrap(), None);

    store
        .record_delivery("hook-1", "2026-07-12T10:00:00+00:00")
        .await
        .unwrap();
    store
        .record_delivery("hook-1", "2026-07-12T11:30:00+00:00")
        .await
        .unwrap();

    let reopened = WebhookStateStore::new(AutomationDb::open(&path).await.unwrap());
    assert_eq!(
        reopened
            .last_delivery_at("hook-1")
            .await
            .unwrap()
            .as_deref(),
        Some("2026-07-12T11:30:00+00:00"),
        "the second delivery replaces the first rather than inserting a row"
    );
    assert_eq!(reopened.last_delivery_at("hook-2").await.unwrap(), None);
}
