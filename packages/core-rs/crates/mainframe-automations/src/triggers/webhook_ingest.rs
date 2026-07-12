//! Webhook ingest pipeline (T8.3): sequences the webhook.rs primitives into
//! one HTTP-agnostic decision — signature → JSON → preset predicate → A7
//! staleness → delivery-id replay dedup → in-memory sample → run. The T9.3
//! route maps decisions onto statuses: UnknownHook 404, InvalidSignature
//! 401, InvalidJson/MissingDeliveryId 400, PresetMismatch/StaleDelivery 204,
//! Duplicate/Accepted 200, StartFailed 500 (sender retries — A7).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::credentials::CredentialStore;
use crate::domain::{Trigger, WebhookTrigger};
use crate::engine::Interpreter;
use crate::error::StoreError;
use crate::store::{AutomationRecord, AutomationStore, RunTriggerContext, RunTriggerKind};

use super::webhook::{
    delivery_id, delivery_timestamp_ms, is_stale_delivery, match_preset, preset_predicate,
    verify_signature,
};

/// The header values the route extracts — this module never sees an HTTP
/// framework type. `signature` is whichever of `X-Signature` /
/// `X-Hub-Signature-256` was present.
#[derive(Debug, Default)]
pub struct WebhookHeaders {
    pub signature: Option<String>,
    pub github_event: Option<String>,
    pub github_delivery: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum WebhookDecision {
    /// No automation carries this hookId → 404.
    UnknownHook,
    /// Missing/garbled signature, or no secret provisioned → 401.
    InvalidSignature,
    /// Body is not a JSON object → 400.
    InvalidJson,
    /// Signature valid but the preset's predicate says no → 204, no run.
    PresetMismatch,
    /// A7: derivable timestamp beyond the 10-minute window → 204, dropped.
    StaleDelivery,
    /// No `X-GitHub-Delivery` and no payload `id` → 400 (malformed, never
    /// a silent no-dedup pass).
    MissingDeliveryId,
    /// A7: replayed delivery id lost the dedup-index race → 200 no-op.
    Duplicate,
    /// Delivery accepted → 200. `run_id` is None for a disabled automation
    /// (deliberately indistinguishable on the wire, so a disabled
    /// automation's hook does not leak its existence).
    Accepted { run_id: Option<String> },
    /// A7: the run could not be started → 500, the sender retries.
    StartFailed { error: String },
}

pub struct WebhookProcessor {
    automations: AutomationStore,
    credentials: Arc<dyn CredentialStore>,
    interpreter: Arc<Interpreter>,
    /// Latest matching payload per (automationId, triggerId) — in-memory
    /// (R3); feeds the editor's "use a sample" affordance once routed.
    samples: Mutex<HashMap<(String, String), Value>>,
}

impl WebhookProcessor {
    pub fn new(
        automations: AutomationStore,
        credentials: Arc<dyn CredentialStore>,
        interpreter: Arc<Interpreter>,
    ) -> Self {
        Self {
            automations,
            credentials,
            interpreter,
            samples: Mutex::new(HashMap::new()),
        }
    }

    pub fn latest_sample(&self, automation_id: &str, trigger_id: &str) -> Option<Value> {
        self.lock_samples()
            .get(&(automation_id.to_string(), trigger_id.to_string()))
            .cloned()
    }

    pub async fn process(
        &self,
        hook_id: &str,
        headers: &WebhookHeaders,
        raw_body: &[u8],
        now_ms: i64,
    ) -> WebhookDecision {
        let (automation, trigger) = match self.find_webhook_trigger(hook_id).await {
            Ok(Some(found)) => found,
            Ok(None) => return WebhookDecision::UnknownHook,
            Err(err) => {
                return WebhookDecision::StartFailed {
                    error: err.to_string(),
                };
            }
        };

        let Some(secret) = self.credentials.get(&format!("webhook:{hook_id}")).await else {
            return WebhookDecision::InvalidSignature;
        };
        if !verify_signature(&secret.token, raw_body, headers.signature.as_deref()) {
            return WebhookDecision::InvalidSignature;
        }

        let Ok(mut payload) = serde_json::from_slice::<Value>(raw_body) else {
            return WebhookDecision::InvalidJson;
        };
        let Some(body) = payload.as_object_mut() else {
            return WebhookDecision::InvalidJson;
        };
        if let Some(event) = &headers.github_event {
            body.insert("event".to_string(), Value::String(event.clone()));
        }

        if let Some(preset) = trigger.preset
            && !match_preset(&preset_predicate(preset), &payload)
        {
            return WebhookDecision::PresetMismatch;
        }

        if let Some(timestamp) = delivery_timestamp_ms(&payload, headers.timestamp.as_deref())
            && is_stale_delivery(timestamp, now_ms)
        {
            tracing::warn!(hook_id, timestamp, "stale webhook delivery dropped");
            return WebhookDecision::StaleDelivery;
        }

        let Some(delivery) = delivery_id(&payload, headers.github_delivery.as_deref()) else {
            return WebhookDecision::MissingDeliveryId;
        };

        self.lock_samples()
            .insert((automation.id.clone(), trigger.id.clone()), payload.clone());

        // Disabled stays a silent accept (TriggerFirer's enabled check made
        // loud here would leak the automation's existence via the status).
        if !automation.enabled {
            return WebhookDecision::Accepted { run_id: None };
        }

        let context = RunTriggerContext {
            kind: RunTriggerKind::Webhook,
            trigger_id: Some(trigger.id.clone()),
            scheduled_for: None,
            payload: Some(payload),
        };
        // Bypasses TriggerFirer so a duplicate (200 no-op) and a start
        // failure (500, sender retries) stay distinguishable (A7).
        match self
            .interpreter
            .start_run(
                &automation.id,
                automation.definition,
                context,
                Some(format!("{}|{delivery}", trigger.id)),
            )
            .await
        {
            Ok(run) => {
                let interpreter = self.interpreter.clone();
                let run_id = run.id.clone();
                tokio::spawn(async move {
                    if let Err(err) = interpreter.advance(&run_id).await {
                        tracing::error!(run_id, error = %err, "webhook delivery: advance failed");
                    }
                });
                WebhookDecision::Accepted {
                    run_id: Some(run.id),
                }
            }
            Err(StoreError::DuplicateFire { .. }) => WebhookDecision::Duplicate,
            Err(err) => WebhookDecision::StartFailed {
                error: err.to_string(),
            },
        }
    }

    /// hookId → its automation + trigger, scanning ALL automations —
    /// disabled ones included, deliberately (see `Accepted{run_id: None}`).
    async fn find_webhook_trigger(
        &self,
        hook_id: &str,
    ) -> Result<Option<(AutomationRecord, WebhookTrigger)>, StoreError> {
        let automations = self.automations.list().await?;
        for automation in automations {
            let trigger = automation
                .definition
                .triggers
                .iter()
                .find_map(|trigger| match trigger {
                    Trigger::Webhook(webhook) if webhook.hook_id == hook_id => {
                        Some(webhook.clone())
                    }
                    _ => None,
                });
            if let Some(trigger) = trigger {
                return Ok(Some((automation, trigger)));
            }
        }
        Ok(None)
    }

    /// Poisoned-map recovery matches advance.rs's lock_map rationale.
    fn lock_samples(&self) -> std::sync::MutexGuard<'_, HashMap<(String, String), Value>> {
        self.samples
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.3), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node routes/automation-webhook.ts order (signature → JSON →
//        preset → staleness → delivery id → sample → enabled → start).
