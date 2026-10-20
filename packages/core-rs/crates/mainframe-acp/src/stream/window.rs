use std::collections::HashSet;

use super::SessionStream;
use crate::{EncodedDelta, EncodedItem, history_window};

pub(super) struct WindowStream {
    pub chat_id: String,
    pub floor: Option<(usize, String)>,
    pub blocked: bool,
}

impl SessionStream {
    pub fn enable_window(&mut self, chat_id: &str) {
        self.window = Some(Box::new(WindowStream {
            chat_id: chat_id.into(),
            floor: None,
            blocked: false,
        }));
    }

    pub fn seed_window(&mut self, chat_id: &str, containers: &[Vec<EncodedItem>]) {
        self.enable_window(chat_id);
        if let Some(window) = &mut self.window {
            window.floor = containers
                .iter()
                .enumerate()
                .find_map(|(pos, items)| items.first().map(|item| (pos, item.id().to_string())));
        }
    }

    pub fn history_floor(&self) -> Option<&str> {
        self.window
            .as_ref()
            .filter(|w| !w.blocked)
            .and_then(|w| w.floor.as_ref().map(|(_, id)| id.as_str()))
    }

    pub fn prepend_history(
        &mut self,
        start: usize,
        containers: &[Vec<EncodedItem>],
        _len: usize,
        previews: HashSet<String>,
    ) {
        self.state.prepend_containers(start, containers, previews);
        if let Some(window) = &mut self.window {
            window.floor = containers
                .iter()
                .enumerate()
                .find_map(|(pos, items)| {
                    items
                        .first()
                        .map(|item| (pos + start, item.id().to_string()))
                })
                .or_else(|| window.floor.clone());
        }
    }

    pub(super) fn window_delta(
        &mut self,
        delta: &EncodedDelta,
        full: impl FnOnce() -> Vec<Vec<EncodedItem>>,
    ) -> Result<EncodedDelta, Option<String>> {
        let Some(window) = &mut self.window else {
            return Ok(delta.clone());
        };
        if window.blocked {
            return Err(None);
        }
        let mut delta = delta.clone();
        if window.floor.is_none() {
            let containers = if delta.full {
                delta
                    .changes
                    .iter()
                    .map(|(_, items)| items.clone())
                    .collect()
            } else {
                full()
            };
            let start = history_window::snap_encoded(
                &containers,
                containers
                    .len()
                    .saturating_sub(history_window::DEFAULT_CONTAINERS),
            );
            window.floor = containers
                .iter()
                .enumerate()
                .skip(start)
                .find_map(|(pos, items)| items.first().map(|item| (pos, item.id().to_string())));
            delta = EncodedDelta::full(containers);
        }
        let Some((floor, id)) = &window.floor else {
            return Ok(delta);
        };
        let mismatched = delta.len <= *floor
            || delta.changes.iter().any(|(pos, items)| {
                pos == floor && items.first().map(EncodedItem::id) != Some(id.as_str())
            });
        if mismatched {
            window.blocked = true;
            return Err(Some(
                serde_json::json!(crate::resync_notification(&window.chat_id)).to_string(),
            ));
        }
        delta.changes.retain(|(pos, _)| pos >= floor);
        // Preserve absolute ordinals when a full delta becomes a sparse window.
        if delta.full {
            delta.full = false;
            self.state.seed_containers(&vec![Vec::new(); delta.len]);
        }
        Ok(delta)
    }
}
