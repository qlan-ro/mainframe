//! Per-spawn bearer credentials. Only the SHA-256 of a token is kept; the raw
//! token exists in the spawn options and the child's environment, nowhere else.
//! Everything here is in memory: the CLIs die with the daemon, so no
//! credential can outlive it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mainframe_types::orchestration::SecretToken;
use mainframe_types::sync::LockExt as _;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::calls::InflightCalls;
use crate::errors::{ErrorCode, ToolError};
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
    waits: Arc<Semaphore>,
    /// The credential's running calls. Request ids are only unique per client
    /// process, so they are scoped to its credential.
    pub(crate) calls: Arc<InflightCalls>,
}

impl Caller {
    /// Claims one of the credential's [`MAX_CONCURRENT_WAITS`] blocking-call
    /// slots, held until the permit drops.
    pub(crate) fn begin_wait(&self) -> Result<OwnedSemaphorePermit, ToolError> {
        Arc::clone(&self.waits).try_acquire_owned().map_err(|_| {
            ToolError::new(
                ErrorCode::RateLimited,
                "Too many concurrent waits for this chat.",
            )
        })
    }
}

#[derive(Default)]
struct Inner {
    by_hash: HashMap<TokenHash, Caller>,
    by_chat: HashMap<String, TokenHash>,
}

impl Inner {
    /// Forgets `chat_id`'s credential and cancels its in-flight calls.
    fn revoke(&mut self, chat_id: &str) -> bool {
        let Some(caller) = self
            .by_chat
            .remove(chat_id)
            .and_then(|digest| self.by_hash.remove(&digest))
        else {
            return false;
        };
        caller.cancel.cancel();
        true
    }
}

#[derive(Default)]
pub struct CredentialRegistry {
    inner: Mutex<Inner>,
}

fn hash(raw: &str) -> TokenHash {
    Sha256::digest(raw.as_bytes()).into()
}

impl CredentialRegistry {
    /// Mints a credential for one spawn of `chat_id`, revoking the chat's
    /// previous one (a respawn or provider switch replaces the process).
    pub(crate) fn issue(&self, chat_id: &str, session_id: &str) -> SecretToken {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let raw = URL_SAFE_NO_PAD.encode(bytes);
        let digest = hash(&raw);
        let mut inner = self.lock();
        inner.revoke(chat_id);
        inner.by_hash.insert(
            digest,
            Caller {
                chat_id: chat_id.to_string(),
                session_id: session_id.to_string(),
                cancel: CancellationToken::new(),
                waits: Arc::new(Semaphore::new(MAX_CONCURRENT_WAITS)),
                calls: Arc::default(),
            },
        );
        inner.by_chat.insert(chat_id.to_string(), digest);
        tracing::debug!(chat_id, session_id, "orchestration credential issued");
        SecretToken::new(raw)
    }

    /// The caller a raw bearer token belongs to, matched by hash only.
    pub fn resolve(&self, raw: &str) -> Option<Caller> {
        self.lock().by_hash.get(&hash(raw)).cloned()
    }

    /// Revokes `chat_id`'s credential and cancels its in-flight calls.
    pub(crate) fn revoke_chat(&self, chat_id: &str) {
        if self.lock().revoke(chat_id) {
            tracing::debug!(chat_id, "orchestration credential revoked");
        }
    }

    /// Revokes the credential issued for the process with `session_id`,
    /// whichever chat holds it.
    pub(crate) fn revoke_by_session_id(&self, session_id: &str) {
        let mut inner = self.lock();
        let chat_id = inner
            .by_hash
            .values()
            .find(|caller| caller.session_id == session_id)
            .map(|caller| caller.chat_id.clone());
        if let Some(chat_id) = chat_id
            && inner.revoke(&chat_id)
        {
            tracing::debug!(chat_id, session_id, "orchestration credential revoked");
        }
    }

    /// Cancels the chat's in-flight calls but keeps the credential: a stopped
    /// turn's waits end now, and the chat's next turn can still call tools.
    pub(crate) fn cancel_inflight(&self, chat_id: &str) {
        let mut inner = self.lock();
        let Some(digest) = inner.by_chat.get(chat_id).copied() else {
            return;
        };
        if let Some(caller) = inner.by_hash.get_mut(&digest) {
            std::mem::take(&mut caller.cancel).cancel();
        }
    }

    pub fn revoke_all(&self) {
        let mut inner = self.lock();
        inner.by_chat.clear();
        for (_, caller) in inner.by_hash.drain() {
            caller.cancel.cancel();
        }
    }

    #[must_use]
    pub fn has_credential(&self, chat_id: &str) -> bool {
        self.lock().by_chat.contains_key(chat_id)
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock_recover()
    }
}

#[cfg(test)]
#[path = "credentials_tests.rs"]
mod tests;
