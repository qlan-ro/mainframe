use serde::{Deserialize, Serialize};

pub const PRESENTATION_SOURCES_KEY: &str = "presentationSources";
pub const PRESENTATION_CONTEXT_KEY: &str = "transcriptPresentation";
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationPhase {
    Work,
    Commentary,
    FinalAnswer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationState {
    Running,
    Completed,
    Cancelled,
    Failed,
    Invalid,
    Unknown,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationTiming {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

impl PresentationTiming {
    pub fn is_valid(&self) -> bool {
        [self.started_at_ms, self.completed_at_ms, self.duration_ms]
            .into_iter()
            .flatten()
            .all(|value| value <= MAX_SAFE_INTEGER)
            && !matches!((self.started_at_ms, self.completed_at_ms), (Some(a), Some(b)) if b < a)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPresentation {
    pub version: u8,
    pub provider: String,
    pub turn_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<PresentationPhase>,
    pub state: PresentationState,
    pub final_eligible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<PresentationTiming>,
}

impl TranscriptPresentation {
    pub fn is_valid(&self) -> bool {
        self.version == 1
            && !self.provider.is_empty()
            && !self.turn_id.is_empty()
            && self
                .parent_tool_use_id
                .as_ref()
                .is_none_or(|id| !id.is_empty())
            && self
                .timing
                .as_ref()
                .is_none_or(PresentationTiming::is_valid)
    }

    pub fn same_turn(&self, other: &Self) -> bool {
        self.provider == other.provider
            && self.turn_id == other.turn_id
            && self.parent_tool_use_id == other.parent_tool_use_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSourceIdentity {
    pub source_message_id: String,
    pub source_block_index: usize,
    pub presentation: TranscriptPresentation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
}

impl PresentationSourceIdentity {
    pub fn is_valid(&self) -> bool {
        !self.source_message_id.is_empty() && self.presentation.is_valid()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PresentationTarget {
    Text {
        #[serde(rename = "contentBlockIndex")]
        content_block_index: usize,
        #[serde(rename = "startUtf16")]
        start_utf16: usize,
        #[serde(rename = "endUtf16")]
        end_utf16: usize,
    },
    Block {
        #[serde(rename = "contentBlockIndex")]
        content_block_index: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationSource {
    #[serde(flatten)]
    pub identity: PresentationSourceIdentity,
    pub target: PresentationTarget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentationSources {
    pub version: u8,
    pub sources: Vec<PresentationSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayPresentationSource {
    #[serde(flatten)]
    pub identity: PresentationSourceIdentity,
    pub path: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayPresentationSources {
    pub version: u8,
    pub sources: Vec<DisplayPresentationSource>,
}

impl DisplayPresentationSources {
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        let parsed: Self = serde_json::from_value(value.clone()).ok()?;
        (parsed.version == 1
            && parsed
                .sources
                .iter()
                .all(|s| s.identity.is_valid() && !s.path.is_empty()))
        .then_some(parsed)
    }
}

pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresentationUpdate {
    pub presentation: TranscriptPresentation,
    pub source_message_ids: Option<Vec<String>>,
}

pub fn deserialize_sources<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<PresentationSources>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    let parsed = serde_json::from_value::<PresentationSources>(value)
        .ok()
        .filter(|s| {
            s.version == 1
                && s.sources.iter().all(|source| {
                    source.identity.is_valid()
                        && match source.target {
                            PresentationTarget::Text {
                                start_utf16,
                                end_utf16,
                                ..
                            } => start_utf16 <= end_utf16,
                            PresentationTarget::Block { .. } => true,
                        }
                })
        });
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_optional_presentation_does_not_reject_legacy_metadata() {
        for value in [
            serde_json::json!({"version":9}),
            serde_json::json!({"version":1,"sources":[{}]}),
        ] {
            let meta: crate::acp::extensions::ItemMeta = serde_json::from_value(serde_json::json!({"containerId":"legacy","streaming":true,"presentationSources":value})).unwrap();
            assert_eq!(meta.streaming, Some(true));
            assert_eq!(meta.container_id.as_deref(), Some("legacy"));
            assert!(meta.presentation_sources.is_none());
        }
    }
    #[test]
    fn utf16_offsets_count_astral_characters_without_splitting_surrogates() {
        assert_eq!(utf16_len("🦀\n\ne\u{301}"), 6);
    }
}
