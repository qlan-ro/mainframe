//! Attachment storage and path helpers.

pub mod attachment_helpers;
pub mod attachment_store;

pub use attachment_helpers::build_attached_file_path_tag;
pub use attachment_store::{
    AttachmentStore, StoredAttachment, StoredAttachmentMeta, sanitize_file_name,
};
