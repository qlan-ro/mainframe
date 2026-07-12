//! Ported from `src/auth/validate-authed-token.ts`.
//!
//! The TS function takes a concrete `DevicesRepository` (from `../db/devices`).
//! That repository lives in `mainframe-db`, which depends on this crate — so to
//! avoid a dependency cycle the lookup is abstracted behind the `DeviceLookup`
//! trait. `mainframe-db`'s `DevicesRepository` will implement it; tests use an
//! in-memory fake (real-collaborator substitute for the vitest in-memory SQLite,
//! keeping the same assertions).

use super::token::{TokenPayload, validate_token};
use mainframe_types::device::DeviceRow;

/// The single method `validateAuthedToken` needs from `DevicesRepository`:
/// `findByDeviceId(deviceId): DeviceRow | null`.
pub trait DeviceLookup {
    fn find_by_device_id(&self, device_id: &str) -> Option<DeviceRow>;
}

/// Mirrors `validateAuthedToken(secret, token, devicesRepo)`.
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

    /// In-memory stand-in for `DevicesRepository`, mirroring the `add` +
    /// `incrementAuthEpoch` + `findByDeviceId` surface the vitest test exercised.
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

// PORT STATUS: src/auth/validate-authed-token.ts (19 lines)
// confidence: high
// todos: 0
// notes: `DevicesRepository` argument abstracted behind the `DeviceLookup` trait
// to avoid a mainframe-db -> mainframe-runtime dependency cycle (mainframe-db
// implements the trait). Tests substitute a HashMap-backed `FakeDevices` for the
// vitest in-memory SQLite `DevicesRepository`, keeping every assertion identical
// (add / incrementAuthEpoch / findByDeviceId behavior preserved). `epoch ?? -1`
// -> `payload.epoch.unwrap_or(-1)`.
