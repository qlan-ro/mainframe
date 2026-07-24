//! Renders a completed `imageGeneration` item, including the disk-read fallback
//! for items that only carry a `savedPath`. Split out of `thread_item_render.rs`
//! to keep that module under the 300-line ceiling.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::MessageContent;

use crate::history::{image_block, text_block};
use crate::item_types::ImageGenerationItem;

pub(crate) fn handle_image_generation(img: ImageGenerationItem, sink: &Arc<dyn SessionSink>) {
    let prompt = img.revised_prompt.filter(|p| !p.is_empty());
    if let Some(inline) = img.result {
        let media = media_type_from_extension(img.saved_path.as_deref().unwrap_or(".png"));
        emit_image(sink, prompt.as_deref(), &media, &inline);
        return;
    }
    let Some(path) = img.saved_path else {
        tracing::warn!(module = "codex:events", id = %img.id, "codex: imageGeneration missing both result and savedPath");
        return;
    };
    // Read the saved image off disk asynchronously, then emit.
    let sink = sink.clone();
    tokio::spawn(async move {
        match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let media = media_type_from_extension(&path);
                emit_image(&sink, prompt.as_deref(), &media, &base64_encode(&bytes));
            }
            Err(err) => {
                tracing::warn!(module = "codex:events", err = %err, path, "codex: failed to read generated image");
            }
        }
    });
}

fn emit_image(sink: &Arc<dyn SessionSink>, prompt: Option<&str>, media_type: &str, data: &str) {
    let mut content: Vec<MessageContent> = vec![image_block(media_type, data)];
    if let Some(p) = prompt {
        content.insert(0, text_block(p));
    }
    sink.on_message(content, None);
}

pub(crate) fn media_type_from_extension(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Minimal standard base64 encoder (no base64 crate in the allowlist), used only
/// for the `imageGeneration` savedPath disk-read fallback.
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[b2 & 0x3f] as char
        } else {
            '='
        });
    }
    out
}
