//! The device lookup needs `DevicesRepository`, which lives in `mainframe-db`,
//! which depends on this crate — so to avoid a dependency cycle the lookup is
//! abstracted behind the `DeviceLookup` trait. `mainframe-server` implements it
//! over `DevicesRepository` (`middleware/auth.rs`); tests use an in-memory fake.

use super::token::{TokenPayload, validate_token};
use mainframe_types::device::DeviceRow;

/// The single method `validate_authed_token` needs from `DevicesRepository`:
/// look up a device row by id.
pub trait DeviceLookup {
    fn find_by_device_id(&self, device_id: &str) -> Option<DeviceRow>;
}

/// Validates `token` and checks its epoch against the device's current
/// `auth_epoch` (a token without an epoch only matches epoch `-1`).
pub fn validate_authed_token<D: DeviceLookup + ?Sized>(
    secret: &str,
    token: &str,
    devices_repo: &D,
) -> Option<TokenPayload> {
    let payload = validate_token(secret, token)?;

    let device = devices_repo.find_by_device_id(&payload.device_id)?;

    let presented_epoch = payload.epoch.unwrap_or(-1);
    if presented_epoch != device.auth_epoch {
        return None;
    }

    Some(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::token::generate_token;
    use mainframe_types::device::Device;
    use std::collections::HashMap;

    const SECRET: &str = "test-secret";

    /// In-memory stand-in for `DevicesRepository` with the `add` +
    /// `incrementAuthEpoch` + `findByDeviceId` surface these tests need.
    #[derive(Default)]
    struct FakeDevices {
        rows: HashMap<String, DeviceRow>,
    }

    impl FakeDevices {
        fn add(&mut self, device_id: &str, device_name: &str) {
            self.rows.insert(
                device_id.to_string(),
                DeviceRow {
                    device: Device {
                        device_id: device_id.to_string(),
                        device_name: device_name.to_string(),
                        created_at: "2026-07-08T00:00:00.000Z".to_string(),
                        last_seen: None,
                    },
                    auth_epoch: 0,
                },
            );
        }

        fn increment_auth_epoch(&mut self, device_id: &str) -> i64 {
            let row = self.rows.get_mut(device_id).expect("device present");
            row.auth_epoch += 1;
            row.auth_epoch
        }
    }

    impl DeviceLookup for FakeDevices {
        fn find_by_device_id(&self, device_id: &str) -> Option<DeviceRow> {
            self.rows.get(device_id).cloned()
        }
    }

    #[test]
    fn returns_payload_for_valid_signature_present_device_matching_epoch() {
        let mut devices = FakeDevices::default();
        devices.add("mobile-1", "iPhone");
        let epoch = devices.increment_auth_epoch("mobile-1");
        let token = generate_token(SECRET, "mobile-1", Some(epoch));
        let payload = validate_authed_token(SECRET, &token, &devices);
        assert!(payload.is_some());
        let payload = payload.unwrap();
        assert_eq!(payload.device_id, "mobile-1");
        assert_eq!(payload.epoch, Some(epoch));
    }

    #[test]
    fn returns_null_for_invalid_signature() {
        let mut devices = FakeDevices::default();
        devices.add("mobile-1", "iPhone");
        devices.increment_auth_epoch("mobile-1");
        let token = generate_token(SECRET, "mobile-1", Some(1));
        assert!(validate_authed_token("wrong-secret", &token, &devices).is_none());
    }

    #[test]
    fn returns_null_when_device_row_is_absent() {
        let devices = FakeDevices::default();
        let token = generate_token(SECRET, "mobile-1", Some(1));
        assert!(validate_authed_token(SECRET, &token, &devices).is_none());
    }

    #[test]
    fn returns_null_for_stale_epoch() {
        let mut devices = FakeDevices::default();
        devices.add("mobile-1", "iPhone");
        let old_epoch = devices.increment_auth_epoch("mobile-1");
        devices.increment_auth_epoch("mobile-1");
        let token = generate_token(SECRET, "mobile-1", Some(old_epoch));
        assert!(validate_authed_token(SECRET, &token, &devices).is_none());
    }

    #[test]
    fn returns_null_when_payload_has_no_epoch() {
        let mut devices = FakeDevices::default();
        devices.add("mobile-1", "iPhone");
        devices.increment_auth_epoch("mobile-1");
        let token = generate_token(SECRET, "mobile-1", None);
        assert!(validate_authed_token(SECRET, &token, &devices).is_none());
    }
}
