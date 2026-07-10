//! Ported from `packages/core/src/chat/resolve-tuning-for-chat.ts`.

use mainframe_adapter_api::BoxFuture;
use mainframe_services::settings::provider_config::{SettingsReader, get_provider_config};
use mainframe_types::adapter::AdapterModel;
use mainframe_types::chat::{Chat, ResolvedTuning, SessionTuning};

use crate::resolve_tuning::{ProviderTuningDefaults, resolve_tuning};

/// The injected dependency surface (mirrors the TS structural `ResolveDeps`):
/// `db.chats.get`, `db.settings.get`, and `adapters.get(id)?.listModels()`.
///
/// `SettingsReader` (super-trait) fulfils `db.settings.get`, so `get_provider_config`
/// consumes the deps object directly. `list_models` returns `[]` when the adapter
/// is absent, mirroring `adapter ? await adapter.listModels() : []`.
pub trait ResolveTuningDeps: SettingsReader + Sync {
    fn get_chat(&self, id: &str) -> Option<Chat>;
    fn list_models<'a>(&'a self, adapter_id: &'a str) -> BoxFuture<'a, Vec<AdapterModel>>;
}

/// THE single resolution site. Used by spawn (lifecycle) and live-apply (chat-manager).
pub async fn resolve_tuning_for_chat<D: ResolveTuningDeps>(
    deps: &D,
    chat_id: &str,
) -> Option<ResolvedTuning> {
    let chat = deps.get_chat(chat_id)?;
    let models = deps.list_models(&chat.adapter_id).await;
    let model_id = chat.model.clone().unwrap_or_default();
    // Exact match → the adapter's default model (covers 'default'/alias/inherited model
    // ids that aren't literal catalog keys) → a capability-less stub as last resort.
    let model: AdapterModel = models
        .iter()
        .find(|m| m.id == model_id)
        .cloned()
        .or_else(|| models.iter().find(|m| m.is_default == Some(true)).cloned())
        .unwrap_or_else(|| AdapterModel {
            id: model_id.clone(),
            label: model_id.clone(),
            description: None,
            context_window: None,
            is_default: None,
            supported_efforts: None,
            default_effort: None,
            supports_fast: None,
            supports_ultracode: None,
            supports_adaptive_thinking: None,
            supports_personality: None,
        });
    let cfg = get_provider_config(deps, &chat.adapter_id);
    let provider = ProviderTuningDefaults {
        default_effort: cfg.default_effort,
        default_fast: cfg.default_fast,
        default_ultracode: cfg.default_ultracode,
        default_adaptive_thinking: cfg.default_adaptive_thinking,
    };
    Some(resolve_tuning(
        &SessionTuning {
            effort: chat.effort,
            fast: chat.fast,
            ultracode: chat.ultracode,
            adaptive_thinking: chat.adaptive_thinking,
        },
        &provider,
        &model,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::EffortLevel;
    use mainframe_types::chat::ChatStatus;

    fn chat_with(model: &str, effort: EffortLevel) -> Chat {
        Chat {
            id: "c".to_string(),
            adapter_id: "claude".to_string(),
            project_id: "p".to_string(),
            title: None,
            claude_session_id: None,
            session_file_path: None,
            model: Some(model.to_string()),
            permission_mode: None,
            plan_mode: None,
            status: ChatStatus::Active,
            created_at: String::new(),
            updated_at: String::new(),
            total_cost: 0.0,
            total_tokens_input: 0,
            total_tokens_output: 0,
            last_context_tokens_input: 0,
            context_files: None,
            mentions: None,
            modified_files: None,
            worktree_path: None,
            branch_name: None,
            process_state: None,
            display_status: None,
            is_running: None,
            worktree_missing: None,
            todos: None,
            pinned: None,
            effort: Some(Some(effort)),
            fast: None,
            ultracode: None,
            adaptive_thinking: None,
            detected_prs: None,
            tags: None,
        }
    }

    struct TestDeps {
        models: Vec<AdapterModel>,
        chat: Chat,
    }

    impl SettingsReader for TestDeps {
        fn get(&self, _ns: &str, _key: &str) -> Option<String> {
            None
        }
    }

    impl ResolveTuningDeps for TestDeps {
        fn get_chat(&self, _id: &str) -> Option<Chat> {
            Some(self.chat.clone())
        }
        fn list_models<'a>(&'a self, _adapter_id: &'a str) -> BoxFuture<'a, Vec<AdapterModel>> {
            let models = self.models.clone();
            Box::pin(async move { models })
        }
    }

    fn model(id: &str, is_default: bool, supported: &[EffortLevel]) -> AdapterModel {
        AdapterModel {
            id: id.to_string(),
            label: id.to_string(),
            description: None,
            context_window: None,
            is_default: if is_default { Some(true) } else { None },
            supported_efforts: Some(supported.to_vec()),
            default_effort: None,
            supports_fast: None,
            supports_ultracode: None,
            supports_adaptive_thinking: None,
            supports_personality: None,
        }
    }

    #[tokio::test]
    async fn keeps_xhigh_when_the_probed_model_supports_it() {
        let models = vec![model(
            "opus[1m]",
            false,
            &[
                EffortLevel::Low,
                EffortLevel::Medium,
                EffortLevel::High,
                EffortLevel::Xhigh,
                EffortLevel::Max,
            ],
        )];
        let deps = TestDeps {
            models,
            chat: chat_with("opus[1m]", EffortLevel::Xhigh),
        };
        let t = resolve_tuning_for_chat(&deps, "c1").await;
        assert_eq!(t.map(|t| t.effort), Some(Some(EffortLevel::Xhigh)));
    }

    #[tokio::test]
    async fn falls_back_to_the_is_default_probed_model_for_an_alias_id() {
        let models = vec![model(
            "claude-x",
            true,
            &[EffortLevel::Low, EffortLevel::High],
        )];
        let deps = TestDeps {
            models,
            chat: chat_with("default", EffortLevel::High),
        };
        let t = resolve_tuning_for_chat(&deps, "c2").await;
        assert_eq!(t.map(|t| t.effort), Some(Some(EffortLevel::High)));
    }
}

// PORT STATUS: src/chat/resolve-tuning-for-chat.ts (30 lines)
// confidence: high
// todos: 0
// notes: TS structural `ResolveDeps` → `ResolveTuningDeps` trait (super-trait
// notes: `SettingsReader` so `get_provider_config` reads `db.settings.get`); the
// notes: not-Send `mainframe-db` sync repos and the async Db actor (mainframe-server)
// notes: are both out of this crate's dep set, so the injected trait is the faithful
// notes: analogue of the TS DI object. `adapters.get(id)?.listModels()` folds into
// notes: `list_models` (empty when adapter absent). Both catalog test cases ported.
