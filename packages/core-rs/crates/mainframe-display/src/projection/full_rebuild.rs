//! A [`super::DisplayProjector`] that always re-runs an injected `prepare`
//! closure and emits `Full`. Test fakes use it, and it is the reference
//! behaviour the incremental projector must stay equivalent to.

use mainframe_types::chat::ChatMessage;
use mainframe_types::display::{DisplayMessage, ToolCategories};

use super::delta::{DisplayDelta, ProjectionStats};
use super::snapshot::DisplaySnapshot;
use super::{DisplayProjector, ProjectionInput};

type Prepare = dyn FnMut(&[ChatMessage], Option<&ChatMessage>, Option<&ToolCategories>) -> Vec<DisplayMessage>
    + Send;

pub struct FullRebuildProjector {
    prepare: Box<Prepare>,
    snapshot: DisplaySnapshot,
}

impl FullRebuildProjector {
    pub fn new(
        prepare: impl FnMut(
            &[ChatMessage],
            Option<&ChatMessage>,
            Option<&ToolCategories>,
        ) -> Vec<DisplayMessage>
        + Send
        + 'static,
    ) -> Self {
        Self {
            prepare: Box::new(prepare),
            snapshot: DisplaySnapshot::new(Vec::new()),
        }
    }
}

impl DisplayProjector for FullRebuildProjector {
    fn project(&mut self, input: ProjectionInput<'_>) -> DisplayDelta {
        let list = (self.prepare)(input.raw, input.overlay, input.categories);
        let len = list.len();
        self.snapshot.replace(list);
        DisplayDelta {
            full: true,
            changes: Vec::new(),
            len,
            snapshot: self.snapshot.clone(),
            stats: ProjectionStats {
                raw_folded: input.raw.len(),
                full_rebuilds: 1,
                ..ProjectionStats::default()
            },
        }
    }
}

#[cfg(test)]
#[path = "full_rebuild_tests.rs"]
mod tests;
