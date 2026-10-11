//! General and provider settings.
//!
//! GET general serialises `GeneralConfig` built from the stored `general` rows
//! (other `general` keys pass through as strings). GET providers assembles the
//! stored provider rows (skipPermissions→yolo, strip skipPermissions), unions
//! `ctx.core.adapter_registry.get_all()` ids, and attaches a `resolvedExecutable` per
//! adapter via `resolve_adapter_executable`. The PUTs validate enum-valued fields
//! by deserialising the enum, then write their rows inside one database job so a
//! notification read-merge-write cannot interleave with another PUT. The
//! config-conflicts route reads the Claude settings file (needs no adapter layer).

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_db::{DbError, SettingsRepository};
use mainframe_services::notifications::{NotificationConfigPatch, parse_notification_config};
use mainframe_types::settings::{GeneralConfig, UpdateChannel};
use mainframe_types::settings_kv::SettingsKv as _;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::async_err::internal_error;
use crate::ctx::AppCtx;
use crate::respond::{fail, ok, ok_empty};
use crate::routes::body::parse_body;

mod providers;

const GENERAL: &str = "general";

// ── general settings ───────────────────────────────────────────────────────────

async fn get_general(State(ctx): State<Arc<AppCtx>>) -> Response {
    let raw = match ctx.core.db.get_by_category(GENERAL).await {
        Ok(raw) => raw,
        Err(err) => return internal_error("get general settings", &err),
    };
    match general_body(raw) {
        Ok(body) => ok(body),
        Err(err) => internal_error("serialize general settings", &err),
    }
}

/// `GeneralConfig` over its defaults from the stored rows, plus every other
/// stored `general` key verbatim (e.g. `titleGeneration.disabled`).
fn general_body(mut raw: HashMap<String, String>) -> Result<Value, serde_json::Error> {
    let defaults = GeneralConfig::default();
    let update_channel = match raw.remove("updateChannel") {
        None => defaults.update_channel,
        Some(stored) => parse_update_channel(&stored).unwrap_or_else(|| {
            tracing::warn!(
                stored,
                "unknown stored update channel; reporting the default"
            );
            defaults.update_channel
        }),
    };
    let config = GeneralConfig {
        worktree_dir: raw.remove("worktreeDir").unwrap_or(defaults.worktree_dir),
        notifications: parse_notification_config(raw.remove("notifications").as_deref()),
        update_channel,
        default_adapter_id: raw.remove("defaultAdapterId"),
    };
    let mut body = serde_json::to_value(config)?;
    if let Some(obj) = body.as_object_mut() {
        obj.extend(raw.into_iter().map(|(k, v)| (k, Value::String(v))));
    }
    Ok(body)
}

fn parse_update_channel(value: &str) -> Option<UpdateChannel> {
    serde_json::from_value(Value::String(value.to_string())).ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneralPatch {
    worktree_dir: Option<String>,
    notifications: Option<NotificationConfigPatch>,
    update_channel: Option<String>,
    #[serde(
        default,
        deserialize_with = "mainframe_types::serde_util::double_option"
    )]
    default_adapter_id: Option<Option<String>>,
}

fn is_valid_worktree_dir(s: &str) -> bool {
    // ^[a-zA-Z0-9._-]+$
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// The 400 message for an invalid patch, or `None` when it is valid.
fn general_patch_error(patch: &GeneralPatch) -> Option<&'static str> {
    // worktreeDir must be non-empty and match `^[a-zA-Z0-9._-]+$` ('Must be a
    // simple directory name'); every failing check's message is joined with ", ".
    // An empty string trips BOTH the length check and the regex; a non-empty bad
    // value only the regex — reproduce each joined form exactly (no field prefix).
    match patch.worktree_dir.as_deref() {
        Some("") => {
            return Some(
                "Too small: expected string to have >=1 characters, Must be a simple directory name",
            );
        }
        Some(wd) if !is_valid_worktree_dir(wd) => return Some("Must be a simple directory name"),
        _ => {}
    }
    if patch
        .update_channel
        .as_deref()
        .is_some_and(|uc| parse_update_channel(uc).is_none())
    {
        return Some("Invalid update channel");
    }
    if let Some(Some(id)) = &patch.default_adapter_id
        && !mainframe_types::ids::is_safe_identifier(id)
    {
        return Some("Invalid adapter id");
    }
    None
}

async fn put_general(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(patch): Option<GeneralPatch> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if let Some(message) = general_patch_error(&patch) {
        return fail(StatusCode::BAD_REQUEST, message);
    }
    let manager = ctx.chat.chat_manager.clone();
    match ctx
        .core
        .db
        .call(move |db| {
            write_general_and_refresh(&db.settings, patch, |config| {
                manager.set_notification_config(config);
            })
        })
        .await
    {
        Ok(()) => ok_empty(),
        Err(err) => internal_error("update general settings", &err),
    }
}

fn write_general_and_refresh(
    settings: &SettingsRepository,
    patch: GeneralPatch,
    refresh: impl FnOnce(mainframe_types::settings::NotificationConfig),
) -> Result<(), DbError> {
    write_general(settings, patch)?;
    let raw = settings.get(GENERAL, "notifications")?;
    refresh(parse_notification_config(raw.as_deref()));
    Ok(())
}

/// Apply a validated patch. A value equal to its default deletes the row, as
/// does an explicit `defaultAdapterId: null`; an absent key leaves its row.
fn write_general(settings: &SettingsRepository, patch: GeneralPatch) -> Result<(), DbError> {
    let defaults = GeneralConfig::default();
    if let Some(wd) = patch.worktree_dir {
        let is_default = wd == defaults.worktree_dir;
        set_or_delete(settings, GENERAL, "worktreeDir", &wd, is_default)?;
    }
    if let Some(uc) = patch.update_channel {
        let is_default = parse_update_channel(&uc) == Some(defaults.update_channel);
        set_or_delete(settings, GENERAL, "updateChannel", &uc, is_default)?;
    }
    match patch.default_adapter_id {
        Some(Some(id)) => settings.set(GENERAL, "defaultAdapterId", &id)?,
        Some(None) => settings.delete(GENERAL, "defaultAdapterId")?,
        None => {}
    }
    if let Some(notifications) = patch.notifications {
        let stored = settings.get(GENERAL, "notifications")?;
        let merged = notifications.apply_to(parse_notification_config(stored.as_deref()));
        settings.set(GENERAL, "notifications", &serde_json::to_string(&merged)?)?;
    }
    Ok(())
}

/// Delete the row when `delete`, else store `value`.
pub(super) fn set_or_delete(
    settings: &SettingsRepository,
    category: &str,
    key: &str,
    value: &str,
    delete: bool,
) -> Result<(), DbError> {
    if delete {
        settings.delete(category, key)
    } else {
        settings.set(category, key, value)
    }
}

// ── Claude config-conflict detection ─────────────────────────────────────────────

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::Array(_) | Value::Object(_) => true,
    }
}

async fn config_conflicts(Path(adapter_id): Path<String>) -> Response {
    if adapter_id != "claude" {
        return ok(json!({ "conflicts": [] }));
    }
    let mut conflicts: Vec<&str> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let settings_path = home.join(".claude").join("settings.json");
        if let Ok(raw) = tokio::fs::read_to_string(&settings_path).await
            && let Ok(settings) = serde_json::from_str::<Value>(&raw)
            && let Some(permissions) = settings.get("permissions")
        {
            if permissions.get("defaultMode").is_some_and(is_truthy) {
                conflicts.push("defaultMode");
            }
            if permissions.get("allow").is_some_and(is_truthy) {
                conflicts.push("allowedTools");
            }
            if permissions.get("deny").is_some_and(is_truthy) {
                conflicts.push("deniedTools");
            }
        }
    }
    ok(json!({ "conflicts": conflicts }))
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new()
        .route("/api/settings/general", get(get_general).put(put_general))
        .route("/api/settings/providers", get(providers::get_providers))
        .route(
            "/api/settings/providers/{adapterId}",
            axum::routing::put(providers::put_provider),
        )
        .route(
            "/api/adapters/{adapterId}/config-conflicts",
            get(config_conflicts),
        )
}

#[cfg(test)]
mod notification_tests {
    use super::*;
    #[test]
    fn settings_write_refreshes_notification_snapshot() {
        let db = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")).unwrap();
        let snapshot = std::sync::RwLock::new(Arc::new(
            mainframe_types::settings::NotificationConfig::default(),
        ));
        let patch =
            serde_json::from_value(json!({"notifications":{"chat":{"taskComplete":false}}}))
                .unwrap();
        write_general_and_refresh(&db.settings, patch, |config| {
            *snapshot.write().unwrap() = Arc::new(config);
        })
        .unwrap();
        assert!(!snapshot.read().unwrap().chat.task_complete);
        assert!(snapshot.read().unwrap().chat.session_error);
    }
}
