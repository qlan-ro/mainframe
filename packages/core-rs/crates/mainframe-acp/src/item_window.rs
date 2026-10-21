use std::collections::HashSet;

use mainframe_types::acp::extensions::{HistoryState, MAINFRAME_META_NAMESPACE};

use crate::EncodedItem;

pub struct ItemWindow {
    pub start: usize,
    pub containers: Vec<Vec<EncodedItem>>,
    pub history: HistoryState,
}

pub fn budget(items: i64) -> usize {
    items.clamp(1, 200) as usize
}

impl ItemWindow {
    pub fn newest(containers: Vec<Vec<EncodedItem>>, start: usize, limit: Option<usize>) -> Self {
        let mut remaining = limit.unwrap_or(usize::MAX);
        for (pos, items) in containers.iter().enumerate().rev() {
            if items.len() >= remaining {
                let offset = items.len() - remaining;
                return Self::from_offset(containers, start, pos, offset);
            }
            remaining -= items.len();
        }
        Self::from_offset(containers, start, 0, 0)
    }

    pub fn track_context(mut self) -> Self {
        let floor = self.history.floor_item_id.as_deref();
        self.history.context_item_ids = Some(
            self.containers
                .iter()
                .flatten()
                .take_while(|item| Some(item.id()) != floor)
                .map(|item| item.id().to_owned())
                .collect(),
        );
        self
    }

    pub fn from_floor(
        containers: Vec<Vec<EncodedItem>>,
        start: usize,
        floor: &str,
    ) -> Result<Self, Vec<Vec<EncodedItem>>> {
        let Some((pos, offset)) = containers.iter().enumerate().find_map(|(pos, items)| {
            items
                .iter()
                .position(|item| item.id() == floor)
                .map(|offset| (pos, offset))
        }) else {
            return Err(containers);
        };
        Ok(Self::from_offset(containers, start, pos, offset))
    }

    fn from_offset(
        mut containers: Vec<Vec<EncodedItem>>,
        start: usize,
        pos: usize,
        offset: usize,
    ) -> Self {
        let pos = if offset == 0 {
            containers
                .iter()
                .enumerate()
                .skip(pos)
                .find(|(_, items)| !items.is_empty())
                .map_or(pos, |(pos, _)| pos)
        } else {
            pos
        };
        let floor_item_id = containers
            .get(pos)
            .and_then(|items| items.get(offset))
            .map(|item| item.id().to_owned());
        if let Some(items) = containers.get_mut(pos) {
            *items = with_ancestors(items, offset, items.len());
        }
        let containers = containers.into_iter().skip(pos).collect();
        Self {
            start: start + pos,
            containers,
            history: HistoryState {
                has_more: start + pos > 0 || offset > 0,
                floor_item_id,
                context_item_ids: None,
            },
        }
    }
}

pub fn parent(item: &EncodedItem) -> Option<&str> {
    let meta = match item {
        EncodedItem::Message { meta, .. }
        | EncodedItem::Thought { meta, .. }
        | EncodedItem::ToolCall { meta, .. } => meta.as_ref()?,
    };
    meta.get(MAINFRAME_META_NAMESPACE)?
        .get("parentToolCallId")?
        .as_str()
}

pub fn with_ancestors(items: &[EncodedItem], start: usize, end: usize) -> Vec<EncodedItem> {
    let mut needed: HashSet<&str> = items[start..end].iter().filter_map(parent).collect();
    let mut context = Vec::new();
    for item in items[..start].iter().rev() {
        if needed.remove(item.id()) {
            context.push(item.clone());
            if let Some(parent) = parent(item) {
                needed.insert(parent);
            }
        }
    }
    context.reverse();
    context.extend_from_slice(&items[start..end]);
    context
}

pub fn retain_floor(items: &mut Vec<EncodedItem>, floor: &str) -> bool {
    let Some(offset) = items.iter().position(|item| item.id() == floor) else {
        return false;
    };
    *items = with_ancestors(items, offset, items.len());
    true
}
