use serde::{Deserialize, Deserializer, Serialize};

pub const MAX_EPOCH_MS: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "TimingFields")]
pub struct ToolCallTiming {
    pub started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TimingFields {
    started_at: u64,
    #[serde(default, deserialize_with = "deserialize_completion")]
    completed_at: Option<u64>,
}

impl ToolCallTiming {
    pub fn is_valid(&self) -> bool {
        self.started_at <= MAX_EPOCH_MS
            && self
                .completed_at
                .is_none_or(|end| end >= self.started_at && end <= MAX_EPOCH_MS)
    }
}

impl TryFrom<TimingFields> for ToolCallTiming {
    type Error = &'static str;

    fn try_from(fields: TimingFields) -> Result<Self, Self::Error> {
        let timing = Self {
            started_at: fields.started_at,
            completed_at: fields.completed_at,
        };
        timing
            .is_valid()
            .then_some(timing)
            .ok_or("invalid tool call epoch milliseconds")
    }
}

pub(crate) fn deserialize_optional<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<ToolCallTiming>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).ok())
}

fn deserialize_completion<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    u64::deserialize(deserializer).map(Some)
}
