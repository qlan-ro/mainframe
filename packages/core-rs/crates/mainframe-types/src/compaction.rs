use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompactionOrigin {
    Idle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCompactionRequest {
    pub id: String,
    pub session_generation: String,
    pub origin: CompactionOrigin,
    pub command_uuid: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionMetadata {
    pub origin: CompactionOrigin,
    pub request_id: String,
    pub session_generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_tokens: Option<u64>,
}

impl NativeCompactionRequest {
    pub fn metadata(&self, vendor_id: Option<&str>) -> CompactionMetadata {
        CompactionMetadata {
            origin: self.origin,
            request_id: self.id.clone(),
            session_generation: self.session_generation.clone(),
            command_uuid: Some(self.command_uuid.clone()),
            vendor_id: vendor_id.map(str::to_owned),
            before_tokens: None,
            after_tokens: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum CacheClassification {
    Claude1h,
    Claude5m,
    #[default]
    Unknown,
}
