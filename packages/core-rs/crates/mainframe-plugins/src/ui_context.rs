//! Ported from `packages/core/src/plugins/ui-context.ts`.
//!
//! Panel/action registration + notifications. Every mutation emits a
//! `DaemonEvent` through the injected sink; the context tracks its own live
//! panel ids so `remove_panel(None)` can tear them all down.

use std::collections::HashSet;
use std::sync::Mutex;

use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::UiZone;

use crate::context::{EmitSink, NotifyOptions, PluginUi};

/// Optional gate — when present and it returns false, `notify` emissions drop.
type NotifyGate = Box<dyn Fn() -> bool + Send + Sync>;

pub struct UiContextImpl {
    plugin_id: String,
    emit: EmitSink,
    is_notify_enabled: Option<NotifyGate>,
    active_panel_ids: Mutex<HashSet<String>>,
}

/// `createPluginUIContext(pluginId, emitEvent, deps)`.
pub fn create_plugin_ui_context(
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
        if let Ok(mut ids) = self.active_panel_ids.lock() {
            ids.insert(panel_id.clone());
        }
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
                if let Ok(mut ids) = self.active_panel_ids.lock() {
                    ids.remove(id);
                }
                (self.emit)(DaemonEvent::PluginPanelUnregistered {
                    plugin_id: self.plugin_id.clone(),
                    panel_id: Some(id.to_string()),
                });
            }
            None => {
                // Remove all panels owned by this plugin.
                let ids: Vec<String> = self
                    .active_panel_ids
                    .lock()
                    .map(|guard| guard.iter().cloned().collect())
                    .unwrap_or_default();
                for panel_id in ids {
                    (self.emit)(DaemonEvent::PluginPanelUnregistered {
                        plugin_id: self.plugin_id.clone(),
                        panel_id: Some(panel_id),
                    });
                }
                if let Ok(mut guard) = self.active_panel_ids.lock() {
                    guard.clear();
                }
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

    fn notify(&self, options: NotifyOptions) {
        if let Some(gate) = &self.is_notify_enabled
            && !gate()
        {
            return;
        }
        (self.emit)(DaemonEvent::PluginNotification {
            plugin_id: self.plugin_id.clone(),
            title: options.title,
            body: options.body,
            level: options.level,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn sink() -> (Arc<Mutex<Vec<DaemonEvent>>>, EmitSink) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let clone = Arc::clone(&seen);
        let emit: EmitSink = Arc::new(move |e| clone.lock().unwrap().push(e));
        (seen, emit)
    }

    #[test]
    fn add_and_remove_panel_emit_events() {
        let (seen, emit) = sink();
        let ui = create_plugin_ui_context("todos", emit, None);
        let panel = ui.add_panel(UiZone::Fullview, "Tasks", Some("square-check"));
        ui.remove_panel(Some(&panel));
        let events = seen.lock().unwrap();
        assert!(matches!(
            events[0],
            DaemonEvent::PluginPanelRegistered { .. }
        ));
        assert!(matches!(
            events[1],
            DaemonEvent::PluginPanelUnregistered { .. }
        ));
    }

    #[test]
    fn notify_gate_drops_when_disabled() {
        let (seen, emit) = sink();
        let ui = create_plugin_ui_context("todos", emit, Some(Box::new(|| false)));
        ui.notify(NotifyOptions {
            title: "t".into(),
            body: "b".into(),
            level: Some("success".into()),
        });
        assert!(seen.lock().unwrap().is_empty());
    }
}

// PORT STATUS: src/plugins/ui-context.ts
// confidence: high
// todos: 0
// notes: activePanelIds → Mutex<HashSet<String>>; remove_panel(None) tears down
// all live panels (each emits its own panelId, as the TS loop does). notify gate
// mirrors deps.isPluginNotifyEnabled (drop when the closure returns false).
