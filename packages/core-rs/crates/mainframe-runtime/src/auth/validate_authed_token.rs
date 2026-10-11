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
#[path = "validate_authed_token_tests.rs"]
mod tests;
