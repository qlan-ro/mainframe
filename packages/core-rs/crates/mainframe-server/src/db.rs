//! The `Send + Sync` database handle backing `AppCtx.db`.
//!
//! `mainframe_db::DatabaseManager` owns an `Rc<rusqlite::Connection>` and is
//! therefore `!Send`, so it cannot live behind the `Arc<AppCtx>` that axum
//! shares across worker tasks. The single WAL-mode connection every repository
//! borrows is confined to one dedicated thread by the shared
//! `mainframe_db::actor::SqliteActor`, and every query is serialized onto it.
//! See `SqliteActor::call_blocking` for the rule the synchronous
//! `ChatManagerDeps` bridge must follow.

use mainframe_services::notifications::parse_notification_config;
use mainframe_types::settings::NotificationConfig;

/// Handle to the single-threaded `DatabaseManager`. `call` ships an
/// `FnOnce(&DatabaseManager)` closure, so every repository is reachable. It is
/// also the daemon's `SettingsKv`.
pub type Db = mainframe_db::actor::SqliteActor<mainframe_db::DatabaseManager>;

pub async fn notification_config(db: &Db) -> NotificationConfig {
    match db
        .call(|d| d.settings.get("general", "notifications"))
        .await
    {
        Ok(raw) => parse_notification_config(raw.as_deref()),
        Err(err) => {
            tracing::warn!( error = %err, category = "general", key = "notifications", "notification settings read failed; using the defaults");
            NotificationConfig::default()
        }
    }
}

#[cfg(test)]
#[path = "db_tests.rs"]
mod tests;
