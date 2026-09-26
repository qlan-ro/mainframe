//! Rule 7 (todo #346) — the no-persistence spawn decision and the
//! context-loss transition it feeds into `lifecycle_manager`'s `do_load_chat`
//! and `do_start_chat`.

use mainframe_types::chat::Chat;

/// Per-spawn decision: a chat only ever spawns with no vendor persistence when
/// it is itself temporary AND the adapter reports the capability. Never
/// derived from the adapter id (AC 2) — callers pass in the registry's
/// reported `capabilities().no_persistence`.
fn should_start_without_persistence(
    temporary: bool,
    adapter_supports_no_persistence: bool,
) -> bool {
    temporary && adapter_supports_no_persistence
}

/// True when the chat's last stored provider session was started with no
/// persistence and still carries a (now-dead) resume id. Checked before the
/// resume target is read in both `do_load_chat` and `do_start_chat` — by the
/// time either reaches this check no live process holds the session (both
/// early-return on an already-spawned session first), so a persisted
/// `vendor_session_ephemeral` flag here always means the CLI never wrote a
/// resumable transcript for `claude_session_id`.
fn context_was_lost(vendor_session_ephemeral: bool, claude_session_id: Option<&str>) -> bool {
    vendor_session_ephemeral && claude_session_id.is_some()
}

/// Rule 6/7's per-spawn decision, exposed as the single call
/// `lifecycle_manager::spawn_prep`'s `resolve_spawn_plan` makes into this
/// module (`should_start_without_persistence` stays private — nothing outside
/// this module needs the bare boolean).
pub fn no_persistence_for_spawn(temporary: bool, adapter_supports_no_persistence: bool) -> bool {
    should_start_without_persistence(temporary, adapter_supports_no_persistence)
}

/// Rule 7's context-loss transition, applied to `chat` IN PLACE: when a dead
/// ephemeral session is detected, clears the resume target and stamps
/// `context_lost_at`, returning `true` so the caller knows to persist +
/// broadcast the change. A no-op (returns `false`) otherwise. This is the
/// pure half of `lifecycle_manager::ChatLifecycleManager::mark_context_lost_if_needed`
/// — the DB write, active-cell mirror and broadcast stay there (they need the
/// deps seam and the active-chat cell this module does not have access to).
pub fn take_context_loss(chat: &mut Chat, now: &str) -> bool {
    if !context_was_lost(
        chat.vendor_session_ephemeral,
        chat.claude_session_id.as_deref(),
    ) {
        return false;
    }
    chat.context_lost_at = Some(now.to_string());
    chat.claude_session_id = None;
    chat.session_file_path = None;
    chat.vendor_session_ephemeral = false;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_persistence_only_when_both_temporary_and_capable() {
        assert!(no_persistence_for_spawn(true, true));
        assert!(!no_persistence_for_spawn(true, false));
        assert!(!no_persistence_for_spawn(false, true));
        assert!(!no_persistence_for_spawn(false, false));
    }

    #[test]
    fn context_lost_requires_both_the_ephemeral_flag_and_a_stored_session_id() {
        assert!(context_was_lost(true, Some("sess-1")));
        assert!(!context_was_lost(true, None));
        assert!(!context_was_lost(false, Some("sess-1")));
        assert!(!context_was_lost(false, None));
    }

    #[test]
    fn take_context_loss_clears_the_resume_target_and_stamps_the_loss() {
        let mut chat = crate::test_support::test_chat("c1");
        chat.vendor_session_ephemeral = true;
        chat.claude_session_id = Some("sess-1".to_string());
        chat.session_file_path = Some("/tmp/sess-1.jsonl".to_string());

        assert!(take_context_loss(&mut chat, "2026-09-25T00:00:00.000Z"));

        assert_eq!(
            chat.context_lost_at.as_deref(),
            Some("2026-09-25T00:00:00.000Z")
        );
        assert!(chat.claude_session_id.is_none());
        assert!(chat.session_file_path.is_none());
        assert!(!chat.vendor_session_ephemeral);
    }

    #[test]
    fn take_context_loss_is_a_noop_for_a_persisted_session() {
        let mut chat = crate::test_support::test_chat("c1");
        chat.vendor_session_ephemeral = false;
        chat.claude_session_id = Some("sess-1".to_string());

        assert!(!take_context_loss(&mut chat, "2026-09-25T00:00:00.000Z"));
        assert!(chat.context_lost_at.is_none());
        assert_eq!(chat.claude_session_id.as_deref(), Some("sess-1"));
    }
}

// PORT STATUS: NEW module (todo #346, G2b)
// confidence: high
// todos: 0
// notes: `should_start_without_persistence`/`context_was_lost` are pure booleans,
// notes: private now that `no_persistence_for_spawn`/`take_context_loss` are the
// notes: only call sites (the review fix moving `lifecycle_manager`'s inline spawn
// notes: prep into `lifecycle_manager/spawn_prep.rs`). The DB write + in-memory
// notes: sync + broadcast that "marking" the loss performs live in
// notes: `lifecycle_manager::ChatLifecycleManager::mark_context_lost_if_needed`,
// notes: which needs the deps seam and the active-chat cell this module does
// notes: not have access to.
