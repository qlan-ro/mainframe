pub mod notification_config;

pub use notification_config::{
    NotificationConfigPatch, parse_notification_config, should_notify_permission,
};
