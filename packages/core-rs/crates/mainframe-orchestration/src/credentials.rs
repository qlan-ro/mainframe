//! Per-spawn bearer credentials. Only the SHA-256 of a token is kept; the raw
//! token exists in the spawn options and the child's environment, nowhere else.
//! Everything here is in memory: the CLIs die with the daemon, so no
//! credential can outlive it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mainframe_types::orchestration::SecretToken;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::policy::MAX_CONCURRENT_WAITS;

type TokenHash = [u8; 32];

/// The authenticated identity behind one MCP request.
#[derive(Debug, Clone)]
pub struct Caller {
    pub chat_id: String,
    pub session_id: String,
    /// Cancelled when the credential is revoked or the chat is stopped, which
    /// ends every in-flight call made with it.
    pub cancel: CancellationToken,
    waits: Arc<AtomicUsize>,
}

impl Caller {
    /// Claims one of the credential's blocking-call slots; `None` when all
    /// [`MAX_CONCURRENT_WAITS`] are taken. The slot frees on drop.
    #[must_use]
    pub(crate) fn try_begin_wait(&self) -> Option<WaitSlot> {
        let prev = self.waits.fetch_add(1, Ordering::SeqCst);
        if prev >= MAX_CONCURRENT_WAITS {
            self.waits.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(WaitSlot(self.waits.clone()))
    }
}

pub struct WaitSlot(Arc<AtomicUsize>);

impl Drop for WaitSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

struct Entry {
    chat_id: String,
    session_id: String,
    cancel: CancellationToken,
    waits: Arc<AtomicUsize>,
    issued_at: SystemTime,
    last_used_at: SystemTime,
}

#[derive(Default)]
struct Inner {
    by_hash: HashMap<TokenHash, Entry>,
    by_chat: HashMap<String, TokenHash>,
}

#[derive(Default)]
pub struct CredentialRegistry {
    inner: Mutex<Inner>,
}

fn hash(raw: &str) -> TokenHash {
    Sha256::digest(raw.as_bytes()).into()
}

impl CredentialRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Mints a credential for one spawn of `chat_id`, revoking the chat's
    /// previous one (a respawn or provider switch replaces the process).
    pub fn issue(&self, chat_id: &str, session_id: &str) -> SecretToken {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let raw = URL_SAFE_NO_PAD.encode(bytes);
        let now = SystemTime::now();
        let mut inner = self.lock();
        if let Some(old) = inner.by_chat.remove(chat_id)
            && let Some(entry) = inner.by_hash.remove(&old)
        {
            entry.cancel.cancel();
        }
        let digest = hash(&raw);
        inner.by_hash.insert(
            digest,
            Entry {
                chat_id: chat_id.to_string(),
                session_id: session_id.to_string(),
                cancel: CancellationToken::new(),
                waits: Arc::new(AtomicUsize::new(0)),
                issued_at: now,
                last_used_at: now,
            },
        );
        inner.by_chat.insert(chat_id.to_string(), digest);
        tracing::debug!(chat_id, session_id, "orchestration credential issued");
        SecretToken::new(raw)
    }

    /// The caller a raw bearer token belongs to, matched by hash only.
    pub fn resolve(&self, raw: &str) -> Option<Caller> {
        let mut inner = self.lock();
        let entry = inner.by_hash.get_mut(&hash(raw))?;
        entry.last_used_at = SystemTime::now();
        Some(Caller {
            chat_id: entry.chat_id.clone(),
            session_id: entry.session_id.clone(),
            cancel: entry.cancel.clone(),
            waits: entry.waits.clone(),
        })
    }

    /// Revokes `chat_id`'s credential and cancels its in-flight calls.
    pub(crate) fn revoke_chat(&self, chat_id: &str) {
        let mut inner = self.lock();
        if let Some(digest) = inner.by_chat.remove(chat_id)
            && let Some(entry) = inner.by_hash.remove(&digest)
        {
            entry.cancel.cancel();
            tracing::debug!(chat_id, "orchestration credential revoked");
        }
    }

    /// Revokes the credential issued for the process with `session_id`,
    /// whichever chat holds it.
    pub(crate) fn revoke_by_session_id(&self, session_id: &str) {
        let chat_id = {
            let inner = self.lock();
            inner
                .by_hash
                .values()
                .find(|e| e.session_id == session_id)
                .map(|e| e.chat_id.clone())
        };
        if let Some(chat_id) = chat_id {
            self.revoke_chat(&chat_id);
        }
    }

    /// Cancels the chat's in-flight calls but keeps the credential: a stopped
    /// turn's waits end now, and the chat's next turn can still call tools.
    pub(crate) fn cancel_inflight(&self, chat_id: &str) {
        let mut inner = self.lock();
        let Some(digest) = inner.by_chat.get(chat_id).copied() else {
            return;
        };
        if let Some(entry) = inner.by_hash.get_mut(&digest) {
            entry.cancel.cancel();
            entry.cancel = CancellationToken::new();
        }
    }

    pub fn revoke_all(&self) {
        let mut inner = self.lock();
        for (_, entry) in inner.by_hash.drain() {
            entry.cancel.cancel();
        }
        inner.by_chat.clear();
    }

    #[must_use]
    pub fn has_credential(&self, chat_id: &str) -> bool {
        self.lock().by_chat.contains_key(chat_id)
    }

    /// `(issued_at, last_used_at)` for diagnostics and tests.
    #[must_use]
    pub fn timestamps(&self, chat_id: &str) -> Option<(SystemTime, SystemTime)> {
        let inner = self.lock();
        let entry = inner.by_hash.get(inner.by_chat.get(chat_id)?)?;
        Some((entry.issued_at, entry.last_used_at))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_revokes_the_previous_credential_and_cancels_its_calls() {
        let reg = CredentialRegistry::new();
        let first = reg.issue("chat", "s1");
        let caller = reg.resolve(first.expose()).unwrap();
        let second = reg.issue("chat", "s2");
        assert!(caller.cancel.is_cancelled());
        assert!(reg.resolve(first.expose()).is_none());
        assert_eq!(reg.resolve(second.expose()).unwrap().session_id, "s2");
    }

    #[test]
    fn resolve_matches_only_the_exact_token() {
        let reg = CredentialRegistry::new();
        let token = reg.issue("chat", "s1");
        assert!(reg.resolve("not-the-token").is_none());
        let mut tampered = token.expose().to_string();
        tampered.push('x');
        assert!(reg.resolve(&tampered).is_none());
        assert_eq!(reg.resolve(token.expose()).unwrap().chat_id, "chat");
    }

    #[test]
    fn revoke_cancels_inflight_tokens() {
        let reg = CredentialRegistry::new();
        let token = reg.issue("chat", "s1");
        let caller = reg.resolve(token.expose()).unwrap();
        reg.revoke_chat("chat");
        assert!(caller.cancel.is_cancelled());
        assert!(reg.resolve(token.expose()).is_none());
    }

    #[test]
    fn a_stale_session_exit_does_not_revoke_its_successor() {
        let reg = CredentialRegistry::new();
        reg.issue("chat", "old");
        let token = reg.issue("chat", "new");
        reg.revoke_by_session_id("old");
        assert!(reg.resolve(token.expose()).is_some());
        reg.revoke_by_session_id("new");
        assert!(reg.resolve(token.expose()).is_none());
    }

    #[test]
    fn cancel_inflight_keeps_the_credential_usable() {
        let reg = CredentialRegistry::new();
        let token = reg.issue("chat", "s1");
        let before = reg.resolve(token.expose()).unwrap();
        reg.cancel_inflight("chat");
        assert!(before.cancel.is_cancelled());
        let after = reg.resolve(token.expose()).unwrap();
        assert!(!after.cancel.is_cancelled());
    }

    #[test]
    fn wait_slots_are_bounded_and_released_on_drop() {
        let reg = CredentialRegistry::new();
        let token = reg.issue("chat", "s1");
        let caller = reg.resolve(token.expose()).unwrap();
        let slots: Vec<_> = (0..MAX_CONCURRENT_WAITS)
            .map(|_| caller.try_begin_wait().unwrap())
            .collect();
        assert!(caller.try_begin_wait().is_none());
        drop(slots);
        assert!(caller.try_begin_wait().is_some());
    }

    #[test]
    fn debug_output_never_contains_the_raw_token() {
        let reg = CredentialRegistry::new();
        let token = reg.issue("chat", "s1");
        let caller = reg.resolve(token.expose()).unwrap();
        assert!(!format!("{token:?} {caller:?}").contains(token.expose()));
    }
}
