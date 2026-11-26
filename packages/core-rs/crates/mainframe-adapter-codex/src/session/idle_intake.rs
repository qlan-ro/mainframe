use std::sync::Mutex;

use mainframe_types::sync::LockExt as _;

#[derive(Default)]
pub(super) struct Intake(Mutex<State>);

#[derive(Default)]
struct State {
    active: usize,
    closing: bool,
}

pub(super) struct Inflight<'a>(&'a Intake);

impl Intake {
    pub(super) fn enter(&self) -> Option<Inflight<'_>> {
        let mut state = self.0.lock_recover();
        if state.closing {
            return None;
        }
        state.active += 1;
        Some(Inflight(self))
    }

    pub(super) fn reserve(&self, still_idle: impl FnOnce() -> bool) -> bool {
        let mut state = self.0.lock_recover();
        if state.active != 0 || state.closing || !still_idle() {
            return false;
        }
        state.closing = true;
        true
    }
}

impl Drop for Inflight<'_> {
    fn drop(&mut self) {
        self.0.0.lock_recover().active -= 1;
    }
}
