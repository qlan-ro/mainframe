use mainframe_types::transcript_presentation::{PresentationPhase, PresentationTiming};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(untagged)]
pub enum OptionalField<T> {
    #[default]
    Missing,
    Known(T),
    Invalid(Value),
}
impl<'de, T: serde::de::DeserializeOwned> Deserialize<'de> for OptionalField<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        Ok(if v.is_null() {
            Self::Missing
        } else {
            match serde_json::from_value(v.clone()) {
                Ok(value) => Self::Known(value),
                Err(_) => Self::Invalid(v),
            }
        })
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    Async,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Question {
    pub title: String,
    pub options: Option<Vec<String>>,
}
pub fn phase<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let v = Value::deserialize(d)?;
    Ok(match v {
        Value::Null => None,
        Value::String(s) => Some(s),
        _ => Some("unsupported".into()),
    })
}
pub(crate) fn agent_phase(
    item: &crate::item_types::AgentMessageItem,
) -> (Option<PresentationPhase>, bool) {
    let phase = match item.phase.as_deref() {
        Some("commentary") => Some(PresentationPhase::Commentary),
        Some("final_answer") => Some(PresentationPhase::FinalAnswer),
        _ => None,
    };
    let ordinary = matches!(item.delivery, OptionalField::Missing)
        && match &item.questions {
            OptionalField::Missing => true,
            OptionalField::Known(q) => q.is_empty(),
            OptionalField::Invalid(_) => false,
        };
    (
        phase,
        phase == Some(PresentationPhase::FinalAnswer) && ordinary,
    )
}
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTiming {
    #[serde(
        default,
        deserialize_with = "number",
        skip_serializing_if = "Option::is_none"
    )]
    pub started_at: Option<u64>,
    #[serde(
        default,
        deserialize_with = "number",
        skip_serializing_if = "Option::is_none"
    )]
    pub completed_at: Option<u64>,
    #[serde(
        default,
        deserialize_with = "number",
        skip_serializing_if = "Option::is_none"
    )]
    pub duration_ms: Option<u64>,
}
fn number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Ok(Value::deserialize(d)?
        .as_u64()
        .filter(|v| *v <= 9_007_199_254_740_991))
}
impl ProviderTiming {
    pub(crate) fn normalized(&self) -> Option<PresentationTiming> {
        let p = PresentationTiming {
            started_at_ms: self.started_at.and_then(|v| v.checked_mul(1000)),
            completed_at_ms: self.completed_at.and_then(|v| v.checked_mul(1000)),
            duration_ms: self.duration_ms,
        };
        (p.is_valid() && p != PresentationTiming::default()).then_some(p)
    }
}
