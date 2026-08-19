//! Webhook registration — the server-computed half of a webhook trigger.
//! Arming provisions and reveals the signing secret (nothing else can, and a
//! sender needs it to sign); reading reports only the last delivery.
//! The ingest URL is composed one layer up: only the server crate knows the
//! port the daemon is listening on.

use std::fmt;

use crate::domain::{AutomationDefinition, Trigger};
use crate::triggers::webhook::ensure_webhook_secret;

use super::{AutomationsEngine, EngineError};

/// Everything the engine knows about a hook. The route pairs it with the
/// ingest URL to form the wire `WebhookRegistration`.
#[derive(Clone, PartialEq, Eq)]
pub struct WebhookState {
    pub hook_id: String,
    /// RFC 3339; `None` means armed but never delivered.
    pub last_delivery_at: Option<String>,
    /// The HMAC key the sender must sign with — `Some` only on the arm path,
    /// so a read is structurally incapable of handing it out.
    pub secret: Option<String>,
}

/// Manual Debug: the secret must not reach logs or error messages, matching
/// the `Credentials` redaction (plan T6.1).
impl fmt::Debug for WebhookState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WebhookState")
            .field("hook_id", &self.hook_id)
            .field("last_delivery_at", &self.last_delivery_at)
            .field("secret", &self.secret.as_ref().map(|_| "[redacted]"))
            .finish()
    }
}

/// Arming both provisions the secret and reveals it. Re-arming reveals the
/// same one rather than rotating: it is the user's only way back to a secret
/// they lost, and rotating would break the signature the sender already
/// computes.
pub(super) async fn arm(
    engine: &AutomationsEngine,
    automation_id: &str,
    trigger_id: &str,
) -> Result<Option<WebhookState>, EngineError> {
    let Some(record) = engine.automations.get(automation_id).await? else {
        return Ok(None);
    };
    let Some(hook_id) = hook_id_of(&record.definition, trigger_id) else {
        return Ok(None);
    };
    let secret = ensure_webhook_secret(engine.credentials.as_ref(), &hook_id).await?;
    Ok(Some(WebhookState {
        secret: Some(secret),
        ..state(engine, &hook_id).await?
    }))
}

/// `None` until the hook is armed: without a secret no sender could have been
/// pointed at it, so there is no registration to report.
pub(super) async fn read(
    engine: &AutomationsEngine,
    hook_id: &str,
) -> Result<Option<WebhookState>, EngineError> {
    if engine
        .credentials
        .get(&format!("webhook:{hook_id}"))
        .await
        .is_none()
    {
        return Ok(None);
    }
    Ok(Some(state(engine, hook_id).await?))
}

/// Drops any client-sent registration before a definition is stored, so a
/// stale save can't claim a hook is live.
pub(super) fn strip(definition: &mut AutomationDefinition) {
    for trigger in &mut definition.triggers {
        if let Trigger::Webhook(hook) = trigger {
            hook.registration = None;
        }
    }
}

async fn state(engine: &AutomationsEngine, hook_id: &str) -> Result<WebhookState, EngineError> {
    Ok(WebhookState {
        hook_id: hook_id.to_string(),
        last_delivery_at: engine.webhook_deliveries.last_delivery_at(hook_id).await?,
        secret: None,
    })
}

fn hook_id_of(definition: &AutomationDefinition, trigger_id: &str) -> Option<String> {
    definition
        .triggers
        .iter()
        .find_map(|trigger| match trigger {
            Trigger::Webhook(hook) if hook.id == trigger_id => Some(hook.hook_id.clone()),
            _ => None,
        })
}

// PORT STATUS: greenfield (docs/plans/2026-07-25-todo-234-automations-editor-plan.md T7), not a TS port
// confidence: high
// todos: 0
// notes: Node has no registration API; its editor showed the hook id raw.
