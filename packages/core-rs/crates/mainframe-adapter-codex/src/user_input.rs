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

pub fn build_turn_input(message: &str, images: &[ImageInput]) -> TurnInput {
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

pub fn undeliverable_notice(reasons: &[UndeliverableReason]) -> Option<String> {
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
mod tests {
    use super::*;
    use serde_json::json;

    fn image(media_type: &str, path: Option<&str>) -> ImageInput {
        ImageInput {
            media_type: media_type.to_string(),
            data: "AAA".to_string(),
            path: path.map(str::to_string),
        }
    }

    #[test]
    fn no_images_produces_the_same_text_only_input_as_before() {
        let out = build_turn_input("hi", &[]);
        assert_eq!(
            serde_json::to_value(out.input).unwrap(),
            json!([{ "type": "text", "text": "hi", "text_elements": [] }])
        );
        assert!(out.undeliverable.is_empty());
    }

    #[test]
    fn one_image_serializes_to_local_image_then_text() {
        let out = build_turn_input("hi", &[image("image/png", Some("/tmp/a.png"))]);
        assert_eq!(
            serde_json::to_value(out.input).unwrap(),
            json!([
                { "type": "localImage", "path": "/tmp/a.png" },
                { "type": "text", "text": "hi", "text_elements": [] }
            ])
        );
        assert!(out.undeliverable.is_empty());
    }

    #[test]
    fn multiple_images_keep_input_order() {
        let out = build_turn_input(
            "hi",
            &[
                image("image/png", Some("/tmp/a.png")),
                image("image/jpeg", Some("/tmp/b.jpg")),
            ],
        );
        assert_eq!(
            serde_json::to_value(out.input).unwrap(),
            json!([
                { "type": "localImage", "path": "/tmp/a.png" },
                { "type": "localImage", "path": "/tmp/b.jpg" },
                { "type": "text", "text": "hi", "text_elements": [] }
            ])
        );
    }

    #[test]
    fn image_without_a_path_is_undeliverable_as_missing_file() {
        let out = build_turn_input("hi", &[image("image/png", None)]);
        assert_eq!(
            serde_json::to_value(&out.input).unwrap(),
            json!([{ "type": "text", "text": "hi", "text_elements": [] }])
        );
        assert_eq!(out.undeliverable, vec![UndeliverableReason::MissingFile]);
    }

    #[test]
    fn unsupported_media_type_is_undeliverable_even_with_a_path() {
        let out = build_turn_input("hi", &[image("image/heic", Some("/tmp/a.heic"))]);
        assert_eq!(
            out.undeliverable,
            vec![UndeliverableReason::UnsupportedFormat]
        );
    }

    #[test]
    fn accepted_media_types_are_png_jpeg_gif_webp() {
        for media_type in [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "IMAGE/PNG",
            "image/png; charset=binary",
        ] {
            let out = build_turn_input("hi", &[image(media_type, Some("/tmp/a.img"))]);
            assert!(
                out.undeliverable.is_empty(),
                "expected {media_type} to deliver"
            );
        }
    }

    #[test]
    fn empty_message_still_carries_a_text_entry() {
        let out = build_turn_input("", &[]);
        assert_eq!(
            serde_json::to_value(out.input).unwrap(),
            json!([{ "type": "text", "text": "", "text_elements": [] }])
        );
    }

    #[test]
    fn notice_is_none_when_nothing_was_dropped() {
        assert_eq!(undeliverable_notice(&[]), None);
    }

    #[test]
    fn notice_singular() {
        assert_eq!(
            undeliverable_notice(&[UndeliverableReason::UnsupportedFormat]),
            Some(
                "1 image couldn't be attached (unsupported format) — the rest of your message was sent."
                    .to_string()
            )
        );
    }

    #[test]
    fn notice_plural_same_reason() {
        assert_eq!(
            undeliverable_notice(&[
                UndeliverableReason::UnsupportedFormat,
                UndeliverableReason::UnsupportedFormat
            ]),
            Some(
                "2 images couldn't be attached (unsupported format) — the rest of your message was sent."
                    .to_string()
            )
        );
    }

    #[test]
    fn notice_mixed_reasons() {
        assert_eq!(
            undeliverable_notice(&[
                UndeliverableReason::UnsupportedFormat,
                UndeliverableReason::UnsupportedFormat,
                UndeliverableReason::MissingFile,
            ]),
            Some(
                "3 images couldn't be attached (2 unsupported format, 1 missing file) — the rest of your message was sent."
                    .to_string()
            )
        );
    }
}
