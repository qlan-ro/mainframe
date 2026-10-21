use std::collections::HashSet;

use crate::encoder::EncodedItem;
use crate::encoder::delta::EncodedDelta;

/// Item IDs owned by each encoded container ordinal.
#[derive(Default)]
pub(crate) struct ContainerIndex(Vec<Vec<String>>);

impl ContainerIndex {
    pub(crate) fn positions_changed(&self, delta: &EncodedDelta) -> bool {
        delta.changes.iter().any(|(pos, items)| {
            self.0.get(*pos).is_some_and(|old| {
                old.first().map(String::as_str) != items.first().map(EncodedItem::id)
            })
        })
    }

    pub(crate) fn position(&self, id: &str) -> Option<usize> {
        self.0
            .iter()
            .position(|items| items.iter().any(|item| item == id))
    }

    pub(crate) fn ids_from(&self, floor: usize) -> HashSet<&str> {
        self.0
            .iter()
            .skip(floor)
            .flatten()
            .map(String::as_str)
            .collect()
    }

    pub(crate) fn ids_after(&self, floor: usize, floor_id: &str) -> HashSet<&str> {
        let mut ids = self.ids_from(floor + 1);
        if let Some(items) = self.0.get(floor)
            && let Some(offset) = items.iter().position(|id| id == floor_id)
        {
            ids.extend(items[offset..].iter().map(String::as_str));
        }
        ids
    }

    pub(crate) fn prepend(&mut self, start: usize, containers: &[Vec<EncodedItem>]) {
        self.0
            .resize_with(self.0.len().max(start + containers.len()), Vec::new);
        for (pos, items) in containers.iter().enumerate() {
            let mut merged: Vec<String> = items.iter().map(|item| item.id().to_owned()).collect();
            let incoming: HashSet<&str> = items.iter().map(EncodedItem::id).collect();
            merged.extend(
                self.0[start + pos]
                    .iter()
                    .filter(|id| !incoming.contains(id.as_str()))
                    .cloned(),
            );
            self.0[start + pos] = merged;
        }
    }

    pub(crate) fn old_ids_for(&self, delta: &EncodedDelta) -> HashSet<String> {
        let mut ids = HashSet::new();
        for (ordinal, _) in &delta.changes {
            if let Some(container_ids) = self.0.get(*ordinal) {
                ids.extend(container_ids.iter().cloned());
            }
        }
        for container_ids in self.0.iter().skip(delta.len) {
            ids.extend(container_ids.iter().cloned());
        }
        ids
    }

    pub(crate) fn update(&mut self, delta: &EncodedDelta) {
        if self.0.len() < delta.len {
            self.0.resize(delta.len, Vec::new());
        }
        for (ordinal, items) in &delta.changes {
            self.0[*ordinal] = items.iter().map(|item| item.id().to_string()).collect();
        }
        self.0.truncate(delta.len);
    }

    pub(crate) fn seed(&mut self, containers: &[Vec<EncodedItem>]) {
        self.0 = containers
            .iter()
            .map(|items| items.iter().map(|item| item.id().to_string()).collect())
            .collect();
    }
}

#[cfg(test)]
mod tests {
    use super::ContainerIndex;
    use crate::encoder::delta::EncodedDelta;

    #[test]
    fn reports_replaced_and_removed_item_ids() {
        use crate::encoder::EncodedItem;
        let thought = |id: &str| EncodedItem::Thought {
            id: id.into(),
            content: vec![],
            meta: None,
        };
        let mut index = ContainerIndex::default();
        index.seed(&[vec![thought("old")], vec![thought("removed")]]);
        let delta = EncodedDelta {
            full: false,
            len: 1,
            changes: vec![(0, vec![thought("new")])],
        };
        let old = index.old_ids_for(&delta);
        assert_eq!(old.len(), 2);
        assert!(old.contains("old"));
        assert!(old.contains("removed"));
        index.update(&delta);
        assert!(
            index
                .old_ids_for(&EncodedDelta {
                    full: false,
                    len: 0,
                    changes: vec![],
                })
                .contains("new")
        );
    }
}
