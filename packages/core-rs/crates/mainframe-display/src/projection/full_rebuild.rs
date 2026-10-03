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
mod tests {
    use super::*;
    use crate::projection::RawChanges;
    use mainframe_types::chat::{ChatMessage, ChatMessageType};
    use mainframe_types::content::LeafContent;
    use mainframe_types::display::DisplayMessageType;

    fn raw(id: &str) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            chat_id: "c".to_string(),
            r#type: ChatMessageType::User,
            content: vec![mainframe_types::chat::MessageContent::Leaf(
                LeafContent::Text {
                    text: "hi".to_string(),
                    parent_tool_use_id: None,
                },
            )],
            timestamp: "t".to_string(),
            metadata: None,
        }
    }

    fn display(id: &str) -> DisplayMessage {
        DisplayMessage {
            id: id.to_string(),
            chat_id: "c".to_string(),
            r#type: DisplayMessageType::User,
            content: Vec::new(),
            timestamp: "t".to_string(),
            metadata: None,
        }
    }

    #[test]
    fn always_emits_full_with_the_materialized_list() {
        let mut projector = FullRebuildProjector::new(|raw, _overlay, _categories| {
            raw.iter().map(|m| display(&m.id)).collect()
        });
        let messages = vec![raw("a"), raw("b")];
        let out = projector.project(ProjectionInput {
            raw: &messages,
            changes: RawChanges::new(),
            overlay: None,
            categories: None,
        });
        assert!(out.full);
        assert_eq!(out.len, 2);
        assert_eq!(
            out.snapshot
                .materialize()
                .iter()
                .map(|m| m.id.clone())
                .collect::<Vec<_>>(),
            vec!["a".to_string(), "b".to_string()]
        );

        // A second call re-runs prepare and still emits Full.
        let messages = vec![raw("a"), raw("b"), raw("c")];
        let out = projector.project(ProjectionInput {
            raw: &messages,
            changes: RawChanges::new(),
            overlay: None,
            categories: None,
        });
        assert!(out.full);
        assert_eq!(out.len, 3);
    }
}
