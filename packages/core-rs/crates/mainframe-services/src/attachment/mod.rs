//! Ported from `src/attachment/index.ts` (re-exports).

pub mod attachment_helpers;
pub mod attachment_store;

pub use attachment_helpers::build_attached_file_path_tag;
pub use attachment_store::{AttachmentStore, StoredAttachment, StoredAttachmentMeta};

// PORT STATUS: src/attachment/index.ts (2 lines)
// confidence: high
// todos: 0
// notes: re-export barrel — mirrors the two `export` lines.
