//! Ported from `src/settings/*`.

pub mod model_default;
pub mod provider_config;

pub use model_default::normalize_saved_default_model;
pub use provider_config::{SettingsReader, get_provider_config};

// PORT STATUS: src/settings/ (module barrel; provider-config.ts + model-default.ts)
// confidence: high
// todos: 0
// notes: SettingsReader is the shared trait for the `db.settings.get` interface
// (provider-config.ts's inline `SettingsReader`); reused by notifications.
// model-default.ts adds normalizeSavedDefaultModel (drop invalid saved defaults).
