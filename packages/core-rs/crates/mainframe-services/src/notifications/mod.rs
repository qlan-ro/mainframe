//! Ported from `src/notifications/*`.

pub mod notification_config;

pub use notification_config::{read_notification_config, should_notify_permission};

// PORT STATUS: src/notifications/ (module barrel)
// confidence: high
// todos: 0
// notes: only notification-config.ts lives here.
