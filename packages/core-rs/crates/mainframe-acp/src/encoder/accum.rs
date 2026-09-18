//! The per-container message/thought accumulator, split out of `content.rs`
//! (its `Accum` is the whole segmenting rule and reads as one unit).

use super::*;

/// Which item an accumulator builds. The role rides along because a message
/// item carries one and a thought item does not.
#[derive(Clone, Copy)]
pub(super) enum AccumKind {
    Message(ItemRole),
    Thought,
}

/// The container's current message/thought item under construction. Claimed
/// (a placeholder pushed) at its first contribution so the finished item sits
/// at first-contribution position.
///
/// A container's text is not one item but a run of *segments*: whenever a
/// tool call, a subagent task, or a thought lands between two text leaves,
/// the open segment closes and the next leaf opens a new one after it. That
/// is what keeps `text → tool → text` rendering in source order instead of
/// folding every paragraph of a turn into one block above all its tools.
pub(super) struct Accum {
    pub(super) kind: AccumKind,
    pub(super) pos: Option<usize>,
    pub(super) segment: usize,
    pub(super) blocks: Vec<ContentBlock>,
    pub(super) error_text: Option<String>,
    pub(super) skill_loaded: Option<SkillLoadedMeta>,
    pub(super) is_compacted: bool,
}

impl Accum {
    pub(super) fn new(kind: AccumKind) -> Self {
        Self {
            kind,
            pos: None,
            segment: 0,
            blocks: Vec::new(),
            error_text: None,
            skill_loaded: None,
            is_compacted: false,
        }
    }

    /// Segment 0 keeps the unsuffixed id (Decision 23: a top-level
    /// container's message item id IS the message id), so the overwhelmingly
    /// common single-segment turn encodes exactly as it did before segments
    /// existed. Later segments suffix the index.
    fn id(&self, container: &Container<'_>) -> String {
        let base = match self.kind {
            AccumKind::Message(_) => container.message_item_id(),
            AccumKind::Thought => format!("{}-thought", container.id),
        };
        match self.segment {
            0 => base,
            n => format!("{base}-{n}"),
        }
    }

    fn placeholder(&self, container: &Container<'_>) -> EncodedItem {
        match self.kind {
            AccumKind::Message(role) => EncodedItem::Message {
                id: self.id(container),
                role,
                content: Vec::new(),
                meta: None,
            },
            AccumKind::Thought => EncodedItem::Thought {
                id: self.id(container),
                content: Vec::new(),
                meta: None,
            },
        }
    }

    /// Build the open segment's finished item, draining the accumulated
    /// state so the accumulator is ready to open the next one.
    fn build(&mut self, container: &Container<'_>) -> EncodedItem {
        let id = self.id(container);
        let content = std::mem::take(&mut self.blocks);
        match self.kind {
            AccumKind::Message(role) => EncodedItem::Message {
                id,
                role,
                content,
                meta: wrap_meta(ItemMeta {
                    error_text: self.error_text.take(),
                    skill_loaded: self.skill_loaded.take(),
                    is_compacted: std::mem::take(&mut self.is_compacted).then_some(true),
                    ..container.base_meta()
                }),
            },
            AccumKind::Thought => EncodedItem::Thought {
                id,
                content,
                meta: wrap_meta(container.base_meta()),
            },
        }
    }

    /// Claim the slot for the next content contribution. An open segment that
    /// is no longer the tail of `out` has had another item pushed after it, so
    /// it closes here and the contribution opens a fresh segment at the tail.
    pub(super) fn claim(
        &mut self,
        out: &mut Vec<EncodedItem>,
        container: &Container<'_>,
    ) -> &mut Self {
        if let Some(pos) = self.pos
            && pos + 1 != out.len()
        {
            out[pos] = self.build(container);
            self.segment += 1;
            self.pos = None;
        }
        self.open(out, container)
    }

    /// Claim for a marker that carries no content of its own (compaction,
    /// skill-loaded). Splitting on one would emit an empty message item just
    /// to hold a flag, and the client reads these markers off the container's
    /// FIRST message item anyway — so a marker rides whichever segment is
    /// already open and only opens one when the container has none yet.
    pub(super) fn claim_marker(
        &mut self,
        out: &mut Vec<EncodedItem>,
        container: &Container<'_>,
    ) -> &mut Self {
        self.open(out, container)
    }

    fn open(&mut self, out: &mut Vec<EncodedItem>, container: &Container<'_>) -> &mut Self {
        if self.pos.is_none() {
            self.pos = Some(out.len());
            out.push(self.placeholder(container));
        }
        self
    }

    pub(super) fn finish(mut self, container: &Container<'_>, out: &mut [EncodedItem]) {
        let Some(pos) = self.pos else { return };
        out[pos] = self.build(container);
    }
}
