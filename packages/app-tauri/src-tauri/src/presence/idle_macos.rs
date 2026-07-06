//! macOS idle-seconds reader via CGEventSource::seconds_since_last_event_type.
//!
//! API reconciliation note (2026-06-25):
//!   - In objc2-core-graphics 0.3.2, the free function
//!     `CGEventSourceSecondsSinceLastEventType` is present but deprecated
//!     (renamed to `CGEventSource::seconds_since_last_event_type`).
//!   - The method is *safe* — no unsafe block required. The crate's
//!     `CGEventTypes` feature gates both the method and the type.
//!   - `kCGAnyInputEventType` (raw 0xFFFF_FFFF) is NOT a named variant in the
//!     crate's `CGEventType` enum. We construct it from its raw value.
//!     This is the documented Apple constant for "any input event" and is the
//!     exact value passed by every known idle-reporter implementation.

use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};

/// Seconds since the last HID (combined keyboard + mouse) event for the
/// current session. Returns 0.0 on any unexpected failure (the CG API always
/// succeeds; the 0.0 fallback means we report active rather than spurious idle).
pub fn system_idle_seconds() -> f64 {
    // kCGAnyInputEventType = 0xFFFF_FFFF — "any input event type" sentinel.
    // This gives the minimum time since any keyboard or mouse event, matching
    // the Electron idle-reporter.ts which calls
    //   powerMonitor.getSystemIdleTime()  (uses the same HID channel).
    let any_input = CGEventType(0xFFFF_FFFF);

    // SAFETY: CGEventSource::seconds_since_last_event_type is a safe method in
    // objc2-core-graphics 0.3.2. The CombinedSessionState queries HID state for
    // the current GUI session, touches no Rust-owned memory, and is documented
    // as safe to call from any thread. No unsafe block is needed here.
    CGEventSource::seconds_since_last_event_type(
        CGEventSourceStateID::CombinedSessionState,
        any_input,
    )
}
