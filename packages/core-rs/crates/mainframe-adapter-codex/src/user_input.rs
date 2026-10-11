//! Builds the Codex `turn/start` `input` array from a message and its images,
//! and the transcript notice for images that didn't make it in.

use mainframe_adapter_api::ImageInput;

use crate::types::UserInput;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UndeliverableReason {
    UnsupportedFormat,
    MissingFile,
}

pub struct TurnInput {
    pub input: Vec<UserInput>,
    pub undeliverable: Vec<UndeliverableReason>,
}

/// Codex `codex-aarch64-apple-darwin` 0.144.3 accepts only these four (see the
/// plan's verified-facts table); anything else routes to the undeliverable path
/// with a clear notice instead of an opaque CLI error.
const DELIVERABLE_MEDIA_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

fn is_deliverable_media_type(media_type: &str) -> bool {
    let base = media_type.split(';').next().unwrap_or("").trim();
    DELIVERABLE_MEDIA_TYPES
        .iter()
        .any(|accepted| accepted.eq_ignore_ascii_case(base))
}

/// Unsupported format wins over a missing path: a `.heic` with no path reports
/// `UnsupportedFormat`, not `MissingFile`.
fn classify(image: &ImageInput) -> Result<&str, UndeliverableReason> {
    if !is_deliverable_media_type(&image.media_type) {
        return Err(UndeliverableReason::UnsupportedFormat);
    }
    image
        .path
        .as_deref()
        .ok_or(UndeliverableReason::MissingFile)
}

pub(crate) fn build_turn_input(message: &str, images: &[ImageInput]) -> TurnInput {
    let mut input = Vec::with_capacity(images.len() + 1);
    let mut undeliverable = Vec::new();
    for image in images {
        match classify(image) {
            Ok(path) => input.push(UserInput::LocalImage {
                path: path.to_string(),
            }),
            Err(reason) => undeliverable.push(reason),
        }
    }
    input.push(UserInput::Text {
        text: message.to_string(),
        text_elements: Some(Vec::new()),
    });
    TurnInput {
        input,
        undeliverable,
    }
}

fn reason_label(reason: UndeliverableReason) -> &'static str {
    match reason {
        UndeliverableReason::UnsupportedFormat => "unsupported format",
        UndeliverableReason::MissingFile => "missing file",
    }
}

pub(crate) fn undeliverable_notice(reasons: &[UndeliverableReason]) -> Option<String> {
    if reasons.is_empty() {
        return None;
    }
    let unsupported = reasons
        .iter()
        .filter(|r| **r == UndeliverableReason::UnsupportedFormat)
        .count();
    let missing = reasons
        .iter()
        .filter(|r| **r == UndeliverableReason::MissingFile)
        .count();
    let groups: Vec<String> = if unsupported > 0 && missing > 0 {
        vec![
            format!(
                "{unsupported} {}",
                reason_label(UndeliverableReason::UnsupportedFormat)
            ),
            format!(
                "{missing} {}",
                reason_label(UndeliverableReason::MissingFile)
            ),
        ]
    } else if unsupported > 0 {
        vec![reason_label(UndeliverableReason::UnsupportedFormat).to_string()]
    } else {
        vec![reason_label(UndeliverableReason::MissingFile).to_string()]
    };
    let count = reasons.len();
    let plural = if count > 1 { "s" } else { "" };
    Some(format!(
        "{count} image{plural} couldn't be attached ({}) — the rest of your message was sent.",
        groups.join(", ")
    ))
}

#[cfg(test)]
#[path = "user_input_tests.rs"]
mod tests;
