//! Native OS-idle presence reporter. Mirrors packages/desktop/src/main/idle-reporter.ts
//! (30s poll, 5-min idle threshold, 4-min keepalive, POST /api/device/activity).
//! Plan 3, decision 4.

// ── Per-platform idle reader ──────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[path = "presence/idle_macos.rs"]
mod idle;
#[cfg(not(target_os = "macos"))]
#[path = "presence/idle_stub.rs"]
mod idle;

// ── Constants (mirrors idle-reporter.ts exactly) ─────────────────────────────

pub const POLL_INTERVAL_MS: u64 = 30_000;
pub const IDLE_THRESHOLD_S: f64 = 5.0 * 60.0; // 300 s
pub const KEEPALIVE_INTERVAL_MS: u128 = 4 * 60 * 1_000; // 240 000 ms

// ── Presence state ────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Presence {
    Active,
    Idle,
}

impl Presence {
    pub fn as_str(self) -> &'static str {
        match self {
            Presence::Active => "active",
            Presence::Idle => "idle",
        }
    }
}

// ── Pure classification (unit-testable, no OS calls) ─────────────────────────

/// Decide presence state from raw idle seconds.
/// Mirrors the idle-reporter.ts `isIdle` check.
pub fn classify(idle_seconds: f64) -> Presence {
    if idle_seconds >= IDLE_THRESHOLD_S {
        Presence::Idle
    } else {
        Presence::Active
    }
}

/// Decide whether to POST based on state transitions and keepalive timing.
/// `elapsed_ms` = milliseconds since the last successful POST.
pub fn should_post(prev: Presence, next: Presence, elapsed_ms: u128) -> bool {
    next != prev || (next == Presence::Active && elapsed_ms >= KEEPALIVE_INTERVAL_MS)
}

// ── Public surface ────────────────────────────────────────────────────────────

pub fn system_idle_seconds() -> f64 {
    idle::system_idle_seconds()
}

// ── Reporter thread ───────────────────────────────────────────────────────────

fn post_state_sync(daemon_port: u16, state: Presence) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{daemon_port}/api/device/activity");
    let body = serde_json::json!({ "state": state.as_str() }).to_string();
    ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Spawn a background thread replicating idle-reporter.ts cadence:
/// - POST `active` on start
/// - Poll every 30 s
/// - POST on state change (active ↔ idle)
/// - POST active keepalive every 4 min while still active
/// - POST failures are logged and do not crash the thread
pub fn start_presence_reporter(daemon_port: u16) {
    std::thread::spawn(move || {
        let mut current = Presence::Active;
        let mut last_reported = std::time::Instant::now();

        // Initial active report on start (mirrors idle-reporter.ts line ~30).
        if let Err(e) = post_state_sync(daemon_port, Presence::Active) {
            tracing::warn!(err = %e, "initial presence report failed (daemon may still be starting)");
        }

        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

            let next = classify(system_idle_seconds());
            let elapsed_ms = last_reported.elapsed().as_millis();

            if should_post(current, next, elapsed_ms) {
                current = next;
                last_reported = std::time::Instant::now();
                if let Err(e) = post_state_sync(daemon_port, current) {
                    tracing::warn!(
                        err = %e,
                        state = current.as_str(),
                        "presence report failed — will retry next poll"
                    );
                } else {
                    tracing::debug!(state = current.as_str(), "presence report sent");
                }
            }
        }
    });
}

// ── Tauri command ─────────────────────────────────────────────────────────────

/// Renderer-driven presence report (called from lib/tauri/bridge.ts reportActivity).
/// Satisfies the HostBridge `presence.reportActivity` contract (Plan 3, decision 4).
#[tauri::command]
pub fn report_activity(state: String, port: tauri::State<'_, DaemonPort>) -> Result<(), String> {
    let parsed = match state.as_str() {
        "active" => Presence::Active,
        "idle" => Presence::Idle,
        other => return Err(format!("invalid presence state: {other}")),
    };
    post_state_sync(port.0, parsed)
}

/// Newtype wrapper so we can manage the daemon port as Tauri state
/// without colliding with any other `u16` state.
pub struct DaemonPort(pub u16);

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn under_threshold_is_active() {
        assert_eq!(classify(0.0), Presence::Active);
        assert_eq!(classify(299.9), Presence::Active);
    }

    #[test]
    fn at_or_over_threshold_is_idle() {
        assert_eq!(classify(300.0), Presence::Idle);
        assert_eq!(classify(900.0), Presence::Idle);
    }

    #[test]
    fn state_change_always_posts() {
        // active → idle: post regardless of elapsed
        assert!(should_post(Presence::Active, Presence::Idle, 0));
        // idle → active: post regardless of elapsed
        assert!(should_post(Presence::Idle, Presence::Active, 0));
    }

    #[test]
    fn no_post_when_state_unchanged_and_keepalive_not_due() {
        // Still active, only 60 s elapsed — no keepalive yet
        assert!(!should_post(Presence::Active, Presence::Active, 60_000));
        // Still idle, only 60 s elapsed — no keepalive for idle
        assert!(!should_post(Presence::Idle, Presence::Idle, 60_000));
    }

    #[test]
    fn active_keepalive_fires_at_4min() {
        // Exactly at the keepalive threshold
        assert!(should_post(
            Presence::Active,
            Presence::Active,
            KEEPALIVE_INTERVAL_MS
        ));
        assert!(should_post(
            Presence::Active,
            Presence::Active,
            KEEPALIVE_INTERVAL_MS + 1
        ));
    }

    #[test]
    fn idle_keepalive_never_fires() {
        // Idle does not send keepalives — mirrors idle-reporter.ts (only active keepalives)
        assert!(!should_post(
            Presence::Idle,
            Presence::Idle,
            KEEPALIVE_INTERVAL_MS
        ));
        assert!(!should_post(
            Presence::Idle,
            Presence::Idle,
            KEEPALIVE_INTERVAL_MS * 100
        ));
    }
}
