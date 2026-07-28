//! Ported from `packages/types/src/session-transcript.ts`.

use serde::Serialize;

/// Adapter-facing transcript lookup result. Not serialized directly — the
/// route wraps it into `TranscriptResolution` for the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TranscriptLocation {
    Present(String),
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptUnavailableReason {
    NeverStarted,
    TranscriptMissing,
}

/// Per-chat transcript resolution mirroring `TranscriptResolution` in
/// `packages/types/src/session-transcript.ts`. `Unknown` means the adapter
/// cannot determine the transcript's location at all — never confuse it with
/// `Unavailable`, whose reason is meaningful.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum TranscriptResolution {
    #[serde(rename_all = "camelCase")]
    Resolved { chat_id: String, path: String },
    #[serde(rename_all = "camelCase")]
    Unavailable {
        chat_id: String,
        reason: TranscriptUnavailableReason,
    },
    #[serde(rename_all = "camelCase")]
    Unknown { chat_id: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveTranscriptsResponse {
    pub resolutions: Vec<TranscriptResolution>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolved_matches_ts_shape() {
        let value = TranscriptResolution::Resolved {
            chat_id: "c1".to_string(),
            path: "/p".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"state":"resolved","chatId":"c1","path":"/p"}"#
        );
    }

    #[test]
    fn unavailable_matches_ts_shape() {
        let value = TranscriptResolution::Unavailable {
            chat_id: "c2".to_string(),
            reason: TranscriptUnavailableReason::NeverStarted,
        };
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"state":"unavailable","chatId":"c2","reason":"never-started"}"#
        );
    }

    #[test]
    fn unknown_matches_ts_shape() {
        let value = TranscriptResolution::Unknown {
            chat_id: "c3".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"state":"unknown","chatId":"c3"}"#
        );
    }
}
