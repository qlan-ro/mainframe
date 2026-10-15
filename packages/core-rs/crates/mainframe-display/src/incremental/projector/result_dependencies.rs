use super::super::result_index::result_blocks;
use super::*;

impl IncrementalProjector {
    pub(super) fn result_rewind(
        &self,
        raw: &[ChatMessage],
        entries: &[RawChange],
        mut r: usize,
    ) -> usize {
        let structural = entries
            .iter()
            .filter_map(|entry| match entry {
                RawChange::Structural(index) => Some(*index),
                _ => None,
            })
            .min();
        if let Some(start) = structural {
            for (_, &owner) in self.result_dependencies.range(start..) {
                r = r.min(owner);
            }
        }
        let start = structural
            .unwrap_or(self.durable_len)
            .min(self.durable_len)
            .min(raw.len());
        for msg in &raw[start..] {
            r = self.result_owner_rewind(msg, r);
        }
        for entry in entries {
            if let RawChange::Nested(index) = entry {
                if let Some(&owner) = self.result_dependencies.get(index) {
                    r = r.min(owner);
                }
                if let Some(msg) = raw.get(*index) {
                    r = self.result_owner_rewind(msg, r);
                }
            }
        }
        r
    }

    fn result_owner_rewind(&self, msg: &ChatMessage, mut r: usize) -> usize {
        for (id, _) in result_blocks(msg) {
            if let Some(&owner) = self.tool_owner.get(id) {
                r = r.min(owner);
            }
        }
        r
    }

    pub(super) fn refresh_result_dependencies(&mut self, raw: &[ChatMessage], start: usize) {
        self.result_dependencies.split_off(&start);
        for (index, msg) in raw.iter().enumerate().skip(start) {
            let owner = result_blocks(msg)
                .filter_map(|(id, _)| self.tool_owner.get(id))
                .min();
            if let Some(&owner) = owner {
                self.result_dependencies.insert(index, owner);
            }
        }
    }
}
