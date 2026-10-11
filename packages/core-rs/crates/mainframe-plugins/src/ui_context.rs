//! Panel/action registration + notifications. Every mutation emits a
//! `DaemonEvent` through the injected sink; the context tracks its own live
//! panel ids so `remove_panel(None)` can tear them all down.

use mainframe_types::sync::LockExt;
use std::collections::HashSet;
use std::sync::Mutex;

use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::UiZone;

use crate::context::{EmitSink, NotifyOptions, PluginUi};

/// Optional gate — when present and it returns false, `notify` emissions drop.
pub(crate) type NotifyGate =
    Box<dyn Fn() -> mainframe_adapter_api::BoxFuture<'static, bool> + Send + Sync>;

pub struct UiContextImpl {
    plugin_id: String,
    emit: EmitSink,
    is_notify_enabled: Option<NotifyGate>,
    active_panel_ids: Mutex<HashSet<String>>,
}

/// `createPluginUIContext(pluginId, emitEvent, deps)`.
pub(crate) fn create_plugin_ui_context(
    plugin_id: &str,
    emit: EmitSink,
    is_notify_enabled: Option<NotifyGate>,
) -> UiContextImpl {
    UiContextImpl {
        plugin_id: plugin_id.to_string(),
        emit,
        is_notify_enabled,
        active_panel_ids: Mutex::new(HashSet::new()),
    }
}

impl PluginUi for UiContextImpl {
    fn add_panel(&self, zone: UiZone, label: &str, icon: Option<&str>) -> String {
        let panel_id = nanoid::nanoid!();
        self.active_panel_ids
            .lock_recover()
            .insert(panel_id.clone());
        (self.emit)(DaemonEvent::PluginPanelRegistered {
            plugin_id: self.plugin_id.clone(),
            panel_id: panel_id.clone(),
            zone,
            label: label.to_string(),
            icon: icon.map(str::to_string),
        });
        panel_id
    }

    fn remove_panel(&self, id: Option<&str>) {
        match id {
            Some(id) => {
                self.active_panel_ids.lock_recover().remove(id);
                (self.emit)(DaemonEvent::PluginPanelUnregistered {
                    plugin_id: self.plugin_id.clone(),
                    panel_id: Some(id.to_string()),
                });
            }
            None => {
                // Remove all panels owned by this plugin.
                let ids: Vec<String> = self
                    .active_panel_ids
                    .lock_recover()
                    .iter()
                    .cloned()
                    .collect();
                for panel_id in ids {
                    (self.emit)(DaemonEvent::PluginPanelUnregistered {
                        plugin_id: self.plugin_id.clone(),
                        panel_id: Some(panel_id),
                    });
                }
                self.active_panel_ids.lock_recover().clear();
            }
        }
    }

    fn add_action(&self, id: &str, label: &str, shortcut: &str, icon: Option<&str>) {
        (self.emit)(DaemonEvent::PluginActionRegistered {
            plugin_id: self.plugin_id.clone(),
            action_id: id.to_string(),
            label: label.to_string(),
            shortcut: shortcut.to_string(),
            icon: icon.map(str::to_string),
        });
    }

    fn remove_action(&self, id: &str) {
        (self.emit)(DaemonEvent::PluginActionUnregistered {
            plugin_id: self.plugin_id.clone(),
            action_id: id.to_string(),
        });
    }

    fn notify(&self, options: NotifyOptions) -> mainframe_adapter_api::BoxFuture<'_, ()> {
        Box::pin(async move {
            if let Some(gate) = &self.is_notify_enabled
                && !gate().await
            {
                return;
            }
            (self.emit)(DaemonEvent::PluginNotification {
                plugin_id: self.plugin_id.clone(),
                title: options.title,
                body: options.body,
                level: options.level,
            });
        })
    }
}

#[cfg(test)]
#[path = "ui_context_tests.rs"]
mod tests;
