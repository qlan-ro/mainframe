//! Provider settings: GET groups the stored `provider` rows per adapter and
//! attaches a `resolvedExecutable`; PUT writes a validated `ProviderConfigUpdate`.

use std::collections::HashMap;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use mainframe_adapter_api::resolve_executable::{ResolverDeps, resolve_adapter_executable};
use mainframe_services::settings::normalize_saved_default_model;
use mainframe_types::settings::ProviderConfigUpdate;
use mainframe_types::settings_kv::{MemorySettings, SettingsKv as _};
use serde_json::{Map, Value, json};

use super::set_or_delete;
use crate::async_err::internal_error;
use crate::ctx::{AppCtx, DefaultRunner};
use crate::respond::{fail, ok, ok_empty};
use crate::routes::body::parse_body;

const PROVIDER: &str = "provider";

fn normalize_provider_default_models(providers: &mut Map<String, Value>) {
    for provider in providers.values_mut() {
        let Some(obj) = provider.as_object_mut() else {
            continue;
        };
        let configured = obj.get("defaultModel").and_then(Value::as_str);
        match normalize_saved_default_model(configured) {
            Some(model) => {
                obj.insert("defaultModel".into(), json!(model));
            }
            None => {
                obj.remove("defaultModel");
            }
        }
    }
}

/// The stored `provider` rows grouped per adapter id (`<id>.<field>` keys;
/// keys without a dot are skipped), with `skipPermissions` folded into
/// `defaultMode: "yolo"` and the saved default model normalised.
fn group_provider_rows(raw: &HashMap<String, String>) -> Map<String, Value> {
    let mut providers: Map<String, Value> = Map::new();
    for (key, value) in raw {
        let Some((adapter_id, field)) = key.split_once('.') else {
            continue;
        };
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
    normalize_provider_default_models(&mut providers);
    providers
}

pub(super) async fn get_providers(State(ctx): State<Arc<AppCtx>>) -> Response {
    let raw = match ctx.core.db.get_by_category(PROVIDER).await {
        Ok(raw) => raw,
        Err(err) => return internal_error("get provider settings", &err),
    };
    let providers = group_provider_rows(&raw);
    // Union the stored-provider ids with every registered adapter id, then attach
    // a `resolvedExecutable` per id. `resolve_adapter_executable` reads only the
    // `provider.<id>.executablePath` setting, so a snapshot of the already-fetched
    // rows backs it: no second db round-trip.
    let mut ids: Vec<String> = providers.keys().cloned().collect();
    for adapter in ctx.core.adapter_registry.get_all() {
        let id = adapter.id().to_string();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let settings = MemorySettings::with_category(PROVIDER, raw);
    let mut out: Map<String, Value> = Map::new();
    for id in ids {
        let resolved = resolve_adapter_executable(
            &id,
            &ResolverDeps {
                settings: &settings,
                run: &DefaultRunner::new(ctx.core.resolved_path.clone()),
                path: &ctx.core.resolved_path,
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
    // PERF: resolution runs live per request (a `PATH` scan per unconfigured
    // adapter) with no memo, on an endpoint the UI polls.
    ok(Value::Object(out))
}

pub(super) async fn put_provider(
    State(ctx): State<Arc<AppCtx>>,
    Path(adapter_id): Path<String>,
    body: Bytes,
) -> Response {
    let Some(patch): Option<ProviderConfigUpdate> = parse_body(&body) else {
        return fail(StatusCode::BAD_REQUEST, "Invalid request body");
    };
    if !patch.is_valid() {
        return fail(StatusCode::BAD_REQUEST, "Invalid provider setting");
    }
    let result = ctx
        .core
        .db
        .call(move |db| {
            // `""` clears a field; setting `defaultMode` retires the legacy
            // `skipPermissions` flag it supersedes.
            for (field, value) in patch.into_present_fields() {
                let key = format!("{adapter_id}.{field}");
                set_or_delete(&db.settings, PROVIDER, &key, &value, value.is_empty())?;
                if field == "defaultMode" {
                    db.settings
                        .delete(PROVIDER, &format!("{adapter_id}.skipPermissions"))?;
                }
            }
            Ok(())
        })
        .await;
    match result {
        Ok(()) => ok_empty(),
        Err(err) => internal_error("update provider settings", &err),
    }
}
