//! Ported from `src/settings/*`.

pub mod provider_config;

pub use provider_config::{SettingsReader, get_provider_config};

// PORT STATUS: src/settings/ (module barrel; only provider-config.ts is under it)
// confidence: high
// todos: 0
// notes: SettingsReader is the shared trait for the `db.settings.get` interface
// (provider-config.ts's inline `SettingsReader`); reused by notifications.
