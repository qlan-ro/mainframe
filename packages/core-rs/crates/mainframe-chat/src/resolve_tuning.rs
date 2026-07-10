//! Ported from `packages/core/src/chat/resolve-tuning.ts`.

use mainframe_types::adapter::{
    AdapterModel, EffortLevel, TUNABLE_FEATURES, clamp_effort_to_supported,
};
use mainframe_types::chat::{ResolvedTuning, SessionTuning};
use mainframe_types::settings::BoolString;

/// Provider config slice the resolver reads (decoded lazily here).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProviderTuningDefaults {
    pub default_effort: Option<EffortLevel>,
    pub default_fast: Option<BoolString>,
    pub default_ultracode: Option<BoolString>,
    pub default_adaptive_thinking: Option<BoolString>,
}

fn clamp_effort(requested: EffortLevel, model: &AdapterModel) -> Option<EffortLevel> {
    clamp_effort_to_supported(
        requested,
        model.supported_efforts.as_deref().unwrap_or(&[]),
        model.default_effort,
    )
}

pub fn resolve_tuning(
    chat: &SessionTuning,
    provider: &ProviderTuningDefaults,
    model: &AdapterModel,
) -> ResolvedTuning {
    let requested_effort = chat
        .effort
        .flatten()
        .or(provider.default_effort)
        .or(model.default_effort)
        .unwrap_or(EffortLevel::Medium);

    let mut out = ResolvedTuning {
        effort: clamp_effort(requested_effort, model),
        fast: false,
        ultracode: false,
        adaptive_thinking: false,
    };

    for f in TUNABLE_FEATURES.iter() {
        let provider_bool = provider_default(provider, f.provider_default).map(bool_string_is_true);
        let requested = chat_feature(chat, f.key).or(provider_bool);
        let capable = model_capability(model, f.capability).unwrap_or(false);
        let value = if capable {
            requested.unwrap_or(false)
        } else {
            false
        };
        match f.key {
            "fast" => out.fast = value,
            "ultracode" => out.ultracode = value,
            "adaptiveThinking" => out.adaptive_thinking = value,
            _ => {}
        }
    }

    if out.ultracode {
        out.effort = Some(EffortLevel::Xhigh);
    }
    out
}

fn bool_string_is_true(b: BoolString) -> bool {
    matches!(b, BoolString::True)
}

fn provider_default(provider: &ProviderTuningDefaults, key: &str) -> Option<BoolString> {
    match key {
        "defaultFast" => provider.default_fast,
        "defaultUltracode" => provider.default_ultracode,
        "defaultAdaptiveThinking" => provider.default_adaptive_thinking,
        _ => None,
    }
}

fn chat_feature(chat: &SessionTuning, key: &str) -> Option<bool> {
    match key {
        "fast" => chat.fast.flatten(),
        "ultracode" => chat.ultracode.flatten(),
        "adaptiveThinking" => chat.adaptive_thinking.flatten(),
        _ => None,
    }
}

fn model_capability(model: &AdapterModel, capability: &str) -> Option<bool> {
    match capability {
        "supportsFast" => model.supports_fast,
        "supportsUltracode" => model.supports_ultracode,
        "supportsAdaptiveThinking" => model.supports_adaptive_thinking,
        _ => None,
    }
}

// PORT STATUS: src/chat/resolve-tuning.ts (44 lines)
// confidence: high
// todos: 0
// notes: `firstDefined(...) ?? 'medium'` → `Option::or` chain + `unwrap_or(Medium)`.
// notes: TS dynamic `provider[f.providerDefault]` / `chat[f.key]` / `model[f.capability]`
// notes: property access becomes match-on-string helpers keyed by the TunableFeature
// notes: constants (3 features). `providerRaw === 'true'` → BoolString::True check.
// notes: ProviderTuningDefaults uses `BoolString` (the typed ProviderConfig fields)
// notes: rather than raw 'true'/'false' strings; resolve_tuning_for_chat adapts.
