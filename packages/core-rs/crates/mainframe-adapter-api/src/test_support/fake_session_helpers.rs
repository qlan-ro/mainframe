//! Constructors and probes for [`FakeSession`], kept apart from the double so
//! that file stays under the length ceiling.
use std::sync::Arc;
use std::sync::atomic::Ordering;

use mainframe_types::sync::LockExt as _;

use super::FakeSession;

impl FakeSession {
    pub fn spawned() -> Self {
        Self {
            spawned: true,
            set_model_ok: true,
            set_permission_mode_ok: true,
            set_plan_mode_ok: true,
            ..Self::default()
        }
    }

    pub fn with_activity(spawned: bool, activity: Option<i64>) -> Arc<Self> {
        Arc::new(Self {
            spawned,
            activity,
            ..Self::default()
        })
    }

    pub fn kills(&self) -> usize {
        self.kill_count.load(Ordering::SeqCst)
    }

    /// Bump "last activity" to `ts` — see `activity_override`.
    pub fn bump_activity(&self, ts: i64) {
        *self.activity_override.lock_recover() = Some(ts);
    }
}
