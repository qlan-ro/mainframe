use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device_id: String,
    pub device_name: String,
    pub created_at: String,
    pub last_seen: Option<String>,
}

/// `DeviceRow extends Device` — `#[serde(flatten)]` reproduces the inline fields
/// (deviceId, deviceName, createdAt, lastSeen) followed by `authEpoch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRow {
    #[serde(flatten)]
    pub device: Device,
    pub auth_epoch: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_serializes_null_last_seen() {
        let json = r#"{"deviceId":"d1","deviceName":"laptop","createdAt":"2026-07-08T00:00:00Z","lastSeen":null}"#;
        let d: Device = serde_json::from_str(json).unwrap();
        assert!(d.last_seen.is_none());
        assert_eq!(serde_json::to_string(&d).unwrap(), json);
    }

    #[test]
    fn device_row_flattens_and_round_trips() {
        let json = r#"{"deviceId":"d1","deviceName":"laptop","createdAt":"2026-07-08T00:00:00Z","lastSeen":"2026-07-08T01:00:00Z","authEpoch":3}"#;
        let row: DeviceRow = serde_json::from_str(json).unwrap();
        assert_eq!(row.auth_epoch, 3);
        assert_eq!(row.device.device_id, "d1");
        assert_eq!(serde_json::to_string(&row).unwrap(), json);
    }
}
