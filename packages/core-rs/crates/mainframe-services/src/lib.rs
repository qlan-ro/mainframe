//! Cross-cutting daemon services for workspace, attachments, push,
//! commands, notifications, settings, files, todos, and quota.
//!
//! Tag color and tag-name validation live in `mainframe-db::tags`, their
//! sole consumer.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod attachment;
pub mod commands;
pub mod files;
pub mod notifications;
pub mod push;
pub mod quota;
pub mod settings;
pub mod todos;
pub mod workspace;
