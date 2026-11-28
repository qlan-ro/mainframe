//! Owns the daemon sidecar handle and launches it off the main thread.
//!
//! The window is created before the daemon starts, so the renderer can ask for
//! the daemon status while the launch is still waiting for its env.
//! [`DaemonSlot::status`] answers `starting` until then, `error:<reason>` if the
//! spawn failed, and `running:<pid>` / `exited` once a handle exists — values
//! the renderer's `mapDaemonStatus` already understands.

use std::sync::{Mutex, OnceLock};

use crate::env_boot::{EnvBoot, EnvSource};
use crate::shell_env::Env;
use crate::sidecar::DaemonHandle;

pub struct DaemonSlot {
    state: Mutex<Slot>,
    handle: OnceLock<DaemonHandle>,
}

#[derive(Debug, PartialEq, Eq)]
enum Slot {
    Pending,
    Launched,
    Failed(String),
    /// Quit began before the launch; the daemon is never spawned.
    Closed,
}

impl DaemonSlot {
    pub const fn new() -> Self {
        Self {
            state: Mutex::new(Slot::Pending),
            handle: OnceLock::new(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get(&self) -> Option<&DaemonHandle> {
        self.handle.get()
    }

    /// The raw status string returned by `get_daemon_status`.
    pub fn status(&self) -> String {
        if let Some(handle) = self.handle.get() {
            return match handle.pid() {
                Some(pid) => format!("running:{pid}"),
                None => "exited".to_string(),
            };
        }
        match &*self.lock() {
            Slot::Pending => "starting".to_string(),
            Slot::Failed(err) => format!("error:{err}"),
            Slot::Launched | Slot::Closed => "exited".to_string(),
        }
    }

    /// Run `spawn` unless the slot was closed or already launched. The state
    /// lock is held across the spawn so [`close`](Self::close) either prevents
    /// it or waits for it, and then sees the handle to stop.
    pub fn launch(
        &self,
        spawn: impl FnOnce() -> Result<DaemonHandle, String>,
    ) -> Option<Result<&DaemonHandle, String>> {
        let mut state = self.lock();
        if *state != Slot::Pending {
            return None;
        }
        match spawn() {
            Ok(handle) => {
                *state = Slot::Launched;
                Some(Ok(self.handle.get_or_init(|| handle)))
            }
            Err(err) => {
                *state = Slot::Failed(err.clone());
                Some(Err(err))
            }
        }
    }

    /// Stop any launch that has not spawned yet. Call before stopping the daemon.
    pub fn close(&self) {
        let mut state = self.lock();
        if *state == Slot::Pending {
            *state = Slot::Closed;
        }
    }
}

/// Wait for the daemon env from `boot`, then spawn through `slot`. `None` when
/// the slot was closed (quit began) while waiting.
pub fn launch_with<'a>(
    slot: &'a DaemonSlot,
    boot: &EnvBoot,
    spawn: impl FnOnce(&Env, EnvSource) -> Result<DaemonHandle, String>,
) -> Option<Result<&'a DaemonHandle, String>> {
    let (env, source) = boot.daemon_env();
    let launched = slot.launch(|| spawn(&env, source));
    if launched.is_none() {
        tracing::info!("daemon launch skipped: the app is quitting");
    }
    launched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_slot_reports_starting() {
        assert_eq!(DaemonSlot::new().status(), "starting");
    }

    #[test]
    fn failed_spawn_reports_the_error() {
        let slot = DaemonSlot::new();
        let result = slot.launch(|| Err("no daemon binary".into())).unwrap();
        assert!(result.is_err());
        assert_eq!(slot.status(), "error:no daemon binary");
        assert!(slot.get().is_none());
    }

    #[test]
    fn launched_slot_holds_the_handle() {
        let slot = DaemonSlot::new();
        assert!(slot
            .launch(|| Ok(DaemonHandle::external()))
            .unwrap()
            .is_ok());
        assert!(slot.get().is_some());
        // An external handle owns no child.
        assert_eq!(slot.status(), "exited");
        assert!(slot.launch(|| panic!("launched twice")).is_none());
    }

    #[test]
    fn closed_slot_never_spawns() {
        let slot = DaemonSlot::new();
        slot.close();
        assert!(slot.launch(|| panic!("spawned after quit")).is_none());
        assert!(slot.get().is_none());
        assert_eq!(slot.status(), "exited");
    }
}
