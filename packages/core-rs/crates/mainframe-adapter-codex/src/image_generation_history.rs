//! `imageGeneration` history-reload conversion — the `convert_thread_items` counterpart
//! to the live path's `handle_image_generation` (`image_generation_render.rs`). Split
//! into its own module so `history.rs` only gains a thin dispatch arm (per the file's
//! line-ceiling note) rather than the full content-block construction inline.

use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};

use crate::history::{image_block, make_message, text_block};
use crate::image_generation_render::media_type_from_extension;
use crate::item_types::ImageGenerationItem;

/// Mirrors `handle_image_generation`'s inline-`result` branch. The savedPath-only
/// disk-read fallback needs an async read plus a sink to deliver the late-arriving
/// message; `convert_thread_items` returns a plain `Vec` synchronously with no sink,
/// so that case is dropped here (logged, not silent) rather than reproduced.
pub(crate) fn image_generation_message(
    img: &ImageGenerationItem,
    chat_id: &str,
) -> Option<ChatMessage> {
    let Some(inline) = &img.result else {
        tracing::debug!(
            module = "codex:history",
            id = %img.id,
            "codex: imageGeneration history item has no inline result, savedPath-only reload is unsupported"
        );
        return None;
    };
    let prompt = img.revised_prompt.as_deref().filter(|p| !p.is_empty());
    let media = media_type_from_extension(img.saved_path.as_deref().unwrap_or(".png"));
    let mut content: Vec<MessageContent> = vec![image_block(&media, inline)];
    if let Some(p) = prompt {
        content.insert(0, text_block(p));
    }
    Some(make_message(
        &img.id,
        chat_id,
        ChatMessageType::Assistant,
        content,
    ))
}
