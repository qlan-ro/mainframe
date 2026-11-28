//! Projects the golden chat one step at a time and records everything a
//! client would see from each step.

use mainframe_acp::{RevisionLog, SessionState, encode};
use mainframe_display::incremental::IncrementalProjector;
use mainframe_display::{DisplayProjector, ProjectionInput, RawChanges};
use mainframe_types::chat::ChatMessage;
use mainframe_types::display::DisplayMessage;
use serde_json::{Value, json};

/// Projects one step at a time and records everything a client would see.
pub struct Recorder {
    projector: IncrementalProjector,
    state: SessionState,
    pub log: RevisionLog,
    pub deltas: Vec<Value>,
    pub live: Vec<Vec<mainframe_types::acp::update::SessionUpdate>>,
    pub cursors: Vec<mainframe_types::acp::extensions::RevisionCursor>,
    pub display: Vec<DisplayMessage>,
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            projector: IncrementalProjector::new(),
            state: SessionState::new(),
            log: RevisionLog::new("epoch-golden".to_string()),
            deltas: Vec::new(),
            live: Vec::new(),
            cursors: Vec::new(),
            display: Vec::new(),
        }
    }

    pub fn step(
        &mut self,
        raw: &[ChatMessage],
        overlay: Option<&ChatMessage>,
        changes: RawChanges,
    ) {
        let delta = self.projector.project(ProjectionInput {
            raw,
            overlay,
            categories: None,
            changes,
        });
        self.display = delta.snapshot.materialize();
        self.deltas.push(json!({
            "full": delta.full,
            "len": delta.len,
            "changes": delta.changes,
        }));
        let items = encode(&self.display);
        self.live.push(self.state.diff(&items));
        self.log.record(&items);
        self.cursors.push(self.log.boundary());
    }
}
