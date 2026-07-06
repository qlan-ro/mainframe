//! Non-macOS fallback: always-active (no portable HID idle API wired yet).
//! Returning 0.0 means classify() always returns Presence::Active, which is
//! the safe default (never spuriously reports idle).
pub fn system_idle_seconds() -> f64 {
    0.0
}
