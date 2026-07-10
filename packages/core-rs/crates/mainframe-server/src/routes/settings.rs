//! Ported from `src/server/routes/settings.ts` — general + provider settings.
//!
//! General GET/PUT and provider PUT port 1:1 over `ctx.db.settings`. GET
//! providers assembles the DB-stored provider settings (skipPermissions→yolo,
//! strip skipPermissions), unions `ctx.adapter_registry.get_all()` ids, and
//! attaches a `resolvedExecutable` per adapter via `resolve_adapter_executable`.
//! The config-conflicts route reads the Claude settings file (needs no adapter
//! layer), so it ports fully.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_adapter_api::resolve_executable::{
    ResolverDeps, SettingsWriter, resolve_adapter_executable,
};
use mainframe_db::DbError;
use mainframe_types::settings::{
    GeneralConfig, NotificationChatConfig, NotificationConfig, NotificationOtherConfig,
    NotificationPermissionConfig,
};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::ctx::{AppCtx, DefaultRunner};
use crate::respond::{fail, ok, ok_empty};
use crate::routes::projects::parse_body;

// ── notification config parse / merge (mirrors the TS salvage helpers) ─────────

#[derive(Deserialize, Default)]
struct ChatPartial {
    #[serde(rename = "taskComplete")]
    task_complete: Option<bool>,
    #[serde(rename = "sessionError")]
    session_error: Option<bool>,
}

#[derive(Deserialize, Default)]
struct PermissionPartial {
    #[serde(rename = "toolRequest")]
    tool_request: Option<bool>,
    #[serde(rename = "userQuestion")]
    user_question: Option<bool>,
    #[serde(rename = "planApproval")]
    plan_approval: Option<bool>,
}

#[derive(Deserialize, Default)]
struct OtherPartial {
    plugin: Option<bool>,
}

#[derive(Deserialize)]
struct NotificationPatch {
    chat: Option<ChatPartial>,
    permission: Option<PermissionPartial>,
    other: Option<OtherPartial>,
}

/// Salvage a per-group partial: an absent or ill-typed group parses to the
/// all-`None` default (→ no overlay → the group stays at its default), matching
/// the TS `salvage()` returning `undefined` on a failed `safeParse`.
fn salvage<T: DeserializeOwned + Default>(root: &Value, key: &str) -> T {
    root.get(key)
        .and_then(|v| serde_json::from_value::<T>(v.clone()).ok())
        .unwrap_or_default()
}

/// Re-validate stored notification JSON on read (defense-in-depth). Malformed
/// JSON or a non-object root → defaults; each group merges over the defaults.
fn parse_notifications(raw: Option<&str>) -> NotificationConfig {
    let d = NotificationConfig::default();
    let Some(raw) = raw else {
        return d;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(raw) else {
        return d;
    };
    let root = if parsed.is_object() {
        parsed
    } else {
        Value::Object(Map::new())
    };
    let chat: ChatPartial = salvage(&root, "chat");
    let permission: PermissionPartial = salvage(&root, "permission");
    let other: OtherPartial = salvage(&root, "other");
    NotificationConfig {
        chat: NotificationChatConfig {
            task_complete: chat.task_complete.unwrap_or(d.chat.task_complete),
            session_error: chat.session_error.unwrap_or(d.chat.session_error),
        },
        permission: NotificationPermissionConfig {
            tool_request: permission.tool_request.unwrap_or(d.permission.tool_request),
            user_question: permission
                .user_question
                .unwrap_or(d.permission.user_question),
            plan_approval: permission
                .plan_approval
                .unwrap_or(d.permission.plan_approval),
        },
        other: NotificationOtherConfig {
            plugin: other.plugin.unwrap_or(d.other.plugin),
        },
    }
}

fn merge_notifications(
    existing: NotificationConfig,
    patch: &NotificationPatch,
) -> NotificationConfig {
    NotificationConfig {
        chat: NotificationChatConfig {
            task_complete: patch
                .chat
                .as_ref()
                .and_then(|c| c.task_complete)
                .unwrap_or(existing.chat.task_complete),
            session_error: patch
                .chat
                .as_ref()
                .and_then(|c| c.session_error)
                .unwrap_or(existing.chat.session_error),
        },
        permission: NotificationPermissionConfig {
            tool_request: patch
                .permission
                .as_ref()
                .and_then(|p| p.tool_request)
                .unwrap_or(existing.permission.tool_request),
            user_question: patch
                .permission
                .as_ref()
                .and_then(|p| p.user_question)
                .unwrap_or(existing.permission.user_question),
            plan_approval: patch
                .permission
                .as_ref()
                .and_then(|p| p.plan_approval)
                .unwrap_or(existing.permission.plan_approval),
        },
        other: NotificationOtherConfig {
            plugin: patch
                .other
                .as_ref()
                .and_then(|o| o.plugin)
                .unwrap_or(existing.other.plugin),
        },
    }
}

// ── general settings ───────────────────────────────────────────────────────────

async fn get_general(State(ctx): State<Arc<AppCtx>>) -> Response {
    let raw = match ctx
        .db
        .call(|db| db.settings.get_by_category("general"))
        .await
    {
        Ok(raw) => raw,
        Err(err) => return crate::async_err::internal_error("get general settings", &err),
    };
    let notifications = parse_notifications(raw.get("notifications").map(String::as_str));
    let mut data = Map::new();
    data.insert(
        "worktreeDir".to_string(),
        Value::String(GeneralConfig::default().worktree_dir),
    );
    for (k, v) in &raw {
        if k != "notifications" {
            data.insert(k.clone(), Value::String(v.clone()));
        }
    }
    data.insert("notifications".to_string(), json!(notifications));
    ok(Value::Object(data))
}

#[derive(Deserialize)]
struct GeneralPatch {
    #[serde(rename = "worktreeDir")]
    worktree_dir: Option<String>,
    notifications: Option<NotificationPatch>,
}

fn is_valid_worktree_dir(s: &str) -> bool {
    // ^[a-zA-Z0-9._-]+$
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

async fn put_general(State(ctx): State<Arc<AppCtx>>, body: Bytes) -> Response {
    let Some(patch): Option<GeneralPatch> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    // worktreeDir: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/, 'Must be a simple
    // directory name'). validate() joins every failing issue's message with ", ".
    // An empty string trips BOTH min(1) and the regex; a non-empty bad value only
    // the regex — reproduce each joined form exactly (no field prefix).
    if let Some(ref wd) = patch.worktree_dir {
        if wd.is_empty() {
            return fail(
                StatusCode::BAD_REQUEST,
                "Too small: expected string to have >=1 characters, Must be a simple directory name",
            );
        }
        if !is_valid_worktree_dir(wd) {
            return fail(StatusCode::BAD_REQUEST, "Must be a simple directory name");
        }
    }

    let GeneralPatch {
        worktree_dir,
        notifications,
    } = patch;
    let result = ctx
        .db
        .call(move |db| {
            if let Some(wd) = worktree_dir {
                if wd == GeneralConfig::default().worktree_dir {
                    db.settings.delete("general", "worktreeDir")?;
                } else {
                    db.settings.set("general", "worktreeDir", &wd)?;
                }
            }
            if let Some(patch) = notifications {
                let existing_raw = db.settings.get("general", "notifications")?;
                let existing = parse_notifications(existing_raw.as_deref());
                let merged = merge_notifications(existing, &patch);
                let serialized =
                    serde_json::to_string(&merged).map_err(|e| DbError::Message(e.to_string()))?;
                db.settings.set("general", "notifications", &serialized)?;
            }
            Ok(())
        })
        .await;
    match result {
        Ok(()) => ok_empty(),
        Err(err) => crate::async_err::internal_error("update general settings", &err),
    }
}

// ── provider settings ───────────────────────────────────────────────────────────

async fn get_providers(State(ctx): State<Arc<AppCtx>>) -> Response {
    let raw = match ctx
        .db
        .call(|db| db.settings.get_by_category("provider"))
        .await
    {
        Ok(raw) => raw,
        Err(err) => return crate::async_err::internal_error("get provider settings", &err),
    };
    let mut providers: Map<String, Value> = Map::new();
    for (key, value) in &raw {
        let Some(dot) = key.find('.') else {
            continue;
        };
        let adapter_id = &key[..dot];
        let field = &key[dot + 1..];
        let entry = providers
            .entry(adapter_id.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert(field.to_string(), Value::String(value.clone()));
        }
    }
    for provider in providers.values_mut() {
        let Some(obj) = provider.as_object_mut() else {
            continue;
        };
        let skip_yes = obj.get("skipPermissions").and_then(Value::as_str) == Some("true");
        if skip_yes && !obj.contains_key("defaultMode") {
            obj.insert("defaultMode".to_string(), Value::String("yolo".to_string()));
        }
        obj.remove("skipPermissions");
    }
    // Union the stored-provider ids with every registered adapter id, then attach
    // a `resolvedExecutable` per id (TS: `ctx.adapters.getAll()` ids +
    // `resolveAdapterExecutableCached`). resolveAdapterExecutable reads only the
    // `provider.<id>.executablePath` setting, so the already-fetched `raw` map
    // backs a read-only SettingsWriter — no second db round-trip.
    let mut ids: Vec<String> = providers.keys().cloned().collect();
    for adapter in ctx.adapter_registry.get_all() {
        let id = adapter.id().to_string();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let settings = RawProviderSettings { raw: &raw };
    let mut out: Map<String, Value> = Map::new();
    for id in ids {
        let resolved = resolve_adapter_executable(
            &id,
            &ResolverDeps {
                settings: &settings,
                run: &DefaultRunner,
                platform: None,
            },
        )
        .await;
        let mut entry = match providers.get(&id) {
            Some(Value::Object(obj)) => obj.clone(),
            _ => Map::new(),
        };
        entry.insert(
            "resolvedExecutable".to_string(),
            serde_json::to_value(&resolved).unwrap_or(Value::Null),
        );
        out.insert(id, Value::Object(entry));
    }
    // PERF(port): the TS memoizes resolution for 5s (`resolveAdapterExecutableCached`)
    // to throttle a polled endpoint; this port resolves live per request (a `which`
    // spawn per unconfigured adapter). Behavior is identical; only the memo is dropped.
    ok(Value::Object(out))
}

/// Read-only `SettingsWriter` over an already-fetched `provider`-category map.
/// `get` answers `provider.<id>.executablePath` lookups from the map; `set` is a
/// no-op (the resolvedExecutable path never persists).
struct RawProviderSettings<'a> {
    raw: &'a std::collections::HashMap<String, String>,
}

impl SettingsWriter for RawProviderSettings<'_> {
    fn get(&self, category: &str, key: &str) -> Option<String> {
        if category == "provider" {
            self.raw.get(key).cloned()
        } else {
            None
        }
    }
    fn set(&self, _category: &str, _key: &str, _value: &str) {}
}

#[derive(Deserialize)]
struct ProviderPatch {
    #[serde(rename = "defaultModel")]
    default_model: Option<String>,
    #[serde(rename = "defaultMode")]
    default_mode: Option<String>,
    #[serde(rename = "defaultPlanMode")]
    default_plan_mode: Option<String>,
    #[serde(rename = "executablePath")]
    executable_path: Option<String>,
    #[serde(rename = "systemPrompt")]
    system_prompt: Option<String>,
    #[serde(rename = "defaultEffort")]
    default_effort: Option<String>,
    #[serde(rename = "defaultFast")]
    default_fast: Option<String>,
    #[serde(rename = "defaultUltracode")]
    default_ultracode: Option<String>,
    #[serde(rename = "defaultAdaptiveThinking")]
    default_adaptive_thinking: Option<String>,
    personality: Option<String>,
    #[serde(rename = "reasoningSummary")]
    reasoning_summary: Option<String>,
}

/// `true` when a present value satisfies its Zod enum. `None` (absent) is always
/// valid; the free-text fields (model/path/prompt) have no enum.
fn in_enum(value: &Option<String>, allowed: &[&str]) -> bool {
    match value {
        None => true,
        Some(v) => allowed.contains(&v.as_str()),
    }
}

fn validate_provider_patch(p: &ProviderPatch) -> bool {
    in_enum(&p.default_mode, &["default", "acceptEdits", "yolo"])
        && in_enum(&p.default_plan_mode, &["true", "false"])
        && in_enum(
            &p.default_effort,
            &[
                "none", "minimal", "low", "medium", "high", "xhigh", "max", "",
            ],
        )
        && in_enum(&p.default_fast, &["true", "false", ""])
        && in_enum(&p.default_ultracode, &["true", "false", ""])
        && in_enum(&p.default_adaptive_thinking, &["true", "false", ""])
        && in_enum(&p.personality, &["none", "friendly", "pragmatic", ""])
        && in_enum(
            &p.reasoning_summary,
            &["auto", "concise", "detailed", "none", ""],
        )
}

/// `set` when the value is truthy (non-empty), else `delete` — the TS
/// `if (value) set; else delete` on every provider field.
fn set_or_delete(
    settings: &mainframe_db::SettingsRepository,
    adapter_id: &str,
    field: &str,
    value: &str,
) -> Result<(), DbError> {
    let key = format!("{adapter_id}.{field}");
    if value.is_empty() {
        settings.delete("provider", &key)
    } else {
        settings.set("provider", &key, value)
    }
}

async fn put_provider(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(patch): Option<ProviderPatch> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if !validate_provider_patch(&patch) {
        return fail(StatusCode::BAD_REQUEST, "Invalid provider setting");
    }

    let result = ctx
        .db
        .call(move |db| {
            let s = &db.settings;
            if let Some(v) = patch.default_model {
                set_or_delete(s, &adapter_id, "defaultModel", &v)?;
            }
            if let Some(v) = patch.default_mode {
                set_or_delete(s, &adapter_id, "defaultMode", &v)?;
                s.delete("provider", &format!("{adapter_id}.skipPermissions"))?;
            }
            if let Some(v) = patch.default_plan_mode {
                set_or_delete(s, &adapter_id, "defaultPlanMode", &v)?;
            }
            if let Some(v) = patch.executable_path {
                set_or_delete(s, &adapter_id, "executablePath", &v)?;
            }
            if let Some(v) = patch.system_prompt {
                set_or_delete(s, &adapter_id, "systemPrompt", &v)?;
            }
            if let Some(v) = patch.default_effort {
                set_or_delete(s, &adapter_id, "defaultEffort", &v)?;
            }
            if let Some(v) = patch.default_fast {
                set_or_delete(s, &adapter_id, "defaultFast", &v)?;
            }
            if let Some(v) = patch.default_ultracode {
                set_or_delete(s, &adapter_id, "defaultUltracode", &v)?;
            }
            if let Some(v) = patch.default_adaptive_thinking {
                set_or_delete(s, &adapter_id, "defaultAdaptiveThinking", &v)?;
            }
            if let Some(v) = patch.personality {
                set_or_delete(s, &adapter_id, "personality", &v)?;
            }
            if let Some(v) = patch.reasoning_summary {
                set_or_delete(s, &adapter_id, "reasoningSummary", &v)?;
            }
            Ok(())
        })
        .await;
    match result {
        Ok(()) => ok_empty(),
        Err(err) => crate::async_err::internal_error("update provider settings", &err),
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
        .route("/api/settings/providers", get(get_providers))
        .route(
            "/api/settings/providers/{adapterId}",
            axum::routing::put(put_provider),
        )
        .route(
            "/api/adapters/{adapterId}/config-conflicts",
            get(config_conflicts),
        )
}

// PORT STATUS: src/server/routes/settings.ts (5 endpoints, 235 lines)
// confidence: medium
// todos: 0
// notes: general GET/PUT (incl. the per-group notification salvage/merge) and
// provider PUT port 1:1 over ctx.db.settings. UpdateProviderSettingsBody's enums
// (each with the '' clear sentinel) validate via explicit allowed-set checks
// (serde loose Option<String> body → in_enum); truthy→set / falsy→delete;
// defaultMode also deletes skipPermissions. GET providers ports the DB grouping
// (skipPermissions→yolo, strip skipPermissions), unions ctx.adapter_registry ids,
// and attaches resolvedExecutable per adapter via resolve_adapter_executable over
// a read-only SettingsWriter backed by the fetched provider map (no 2nd db call).
// PERF(port): the 5s resolve memo (resolveAdapterExecutableCached) is dropped —
// each request resolves live. config-conflicts reads ~/.claude/settings.json via
// async tokio::fs (no sync I/O) and matches JS truthiness for allow/deny.
