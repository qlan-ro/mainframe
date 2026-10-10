//! Renders a completed `imageGeneration` item, including the disk-read fallback
//! for items that only carry a `savedPath`. Split out of `thread_item_render.rs`
//! to keep that module under the 300-line ceiling.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::MessageContent;

use crate::history::{image_block, text_block, vendor_metadata};
use crate::item_types::ImageGenerationItem;

pub(crate) fn handle_image_generation(img: ImageGenerationItem, sink: &Arc<dyn SessionSink>) {
    let id = img.id.clone();
    let prompt = img.revised_prompt.filter(|p| !p.is_empty());
    if let Some(inline) = img.result {
        let media = media_type_from_extension(img.saved_path.as_deref().unwrap_or(".png"));
        emit_image(sink, &id, prompt.as_deref(), &media, &inline);
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
                emit_image(
                    &sink,
                    &id,
                    prompt.as_deref(),
                    &media,
                    &mainframe_types::base64_data::encode(&bytes),
                );
            }
            Err(err) => {
                tracing::warn!(module = "codex:events", err = %err, path, "codex: failed to read generated image");
            }
        }
    });
}

fn emit_image(
    sink: &Arc<dyn SessionSink>,
    id: &str,
    prompt: Option<&str>,
    media_type: &str,
    data: &str,
) {
    let mut content: Vec<MessageContent> = vec![image_block(media_type, data)];
    if let Some(p) = prompt {
        content.insert(0, text_block(p));
    }
    sink.on_message(content, vendor_metadata(id));
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
