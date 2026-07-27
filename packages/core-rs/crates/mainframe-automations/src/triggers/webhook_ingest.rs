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
use crate::store::{
    AutomationRecord, AutomationStore, RunTriggerContext, RunTriggerKind, WebhookStateStore,
};

use super::webhook::{
    delivery_id, delivery_timestamp_ms, is_stale_delivery, match_preset, parse_payload,
    preset_predicate, verify_signature,
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

impl WebhookDecision {
    /// The one log site for a refused delivery. Without it the panel's "no
    /// deliveries yet" reads the same whether the sender never called or every
    /// call was refused. `reason` is a static string — the secret, the
    /// signature and the body never appear in it.
    fn rejected(self, hook_id: &str, reason: &'static str) -> Self {
        tracing::warn!(hook_id, reason, "webhook delivery rejected");
        self
    }
}

pub struct WebhookProcessor {
    automations: AutomationStore,
    credentials: Arc<dyn CredentialStore>,
    interpreter: Arc<Interpreter>,
    state: WebhookStateStore,
    /// Latest matching payload per (automationId, triggerId) — in-memory
    /// (R3); feeds the editor's "use a sample" affordance once routed.
    samples: Mutex<HashMap<(String, String), Value>>,
}

impl WebhookProcessor {
    pub fn new(
        automations: AutomationStore,
        credentials: Arc<dyn CredentialStore>,
        interpreter: Arc<Interpreter>,
        state: WebhookStateStore,
    ) -> Self {
        Self {
            automations,
            credentials,
            interpreter,
            state,
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
            Ok(None) => {
                return WebhookDecision::UnknownHook
                    .rejected(hook_id, "no automation carries this hook id");
            }
            Err(err) => {
                return WebhookDecision::StartFailed {
                    error: err.to_string(),
                };
            }
        };

        if let Err(reason) = self.verify(hook_id, headers, raw_body).await {
            return WebhookDecision::InvalidSignature.rejected(hook_id, reason);
        }
        let Some(payload) = parse_payload(raw_body, headers.github_event.as_deref()) else {
            return WebhookDecision::InvalidJson.rejected(hook_id, "body is not a JSON object");
        };

        self.stamp_delivery(hook_id, now_ms).await;

        let delivery = match screen(hook_id, &trigger, &payload, headers, now_ms) {
            Ok(delivery) => delivery,
            Err(decision) => return decision,
        };

        self.lock_samples()
            .insert((automation.id.clone(), trigger.id.clone()), payload.clone());

        // Disabled stays a silent accept (TriggerFirer's enabled check made
        // loud here would leak the automation's existence via the status).
        if !automation.enabled {
            return WebhookDecision::Accepted { run_id: None };
        }
        self.start_run(automation, &trigger.id, payload, &delivery)
            .await
    }

    /// The `Err` reason is for the server log only: a hook nobody armed, an
    /// unsigned delivery and a wrong secret are one 401 on the wire but three
    /// different fixes for whoever is wiring the sender up.
    async fn verify(
        &self,
        hook_id: &str,
        headers: &WebhookHeaders,
        raw_body: &[u8],
    ) -> Result<(), &'static str> {
        let Some(secret) = self.credentials.get(&format!("webhook:{hook_id}")).await else {
            return Err("hook is not armed — no signing secret is provisioned");
        };
        if headers.signature.is_none() {
            return Err("delivery carried no signature header");
        }
        if !verify_signature(&secret.token, raw_body, headers.signature.as_deref()) {
            return Err("signature does not match the hook's secret");
        }
        Ok(())
    }

    /// Bypasses TriggerFirer so a duplicate (200 no-op) and a start failure
    /// (500, sender retries) stay distinguishable (A7).
    async fn start_run(
        &self,
        automation: AutomationRecord,
        trigger_id: &str,
        payload: Value,
        delivery: &str,
    ) -> WebhookDecision {
        let context = RunTriggerContext {
            kind: RunTriggerKind::Webhook,
            trigger_id: Some(trigger_id.to_string()),
            scheduled_for: None,
            payload: Some(payload),
        };
        match self
            .interpreter
            .start_run(
                &automation.id,
                automation.definition,
                context,
                Some(format!("{trigger_id}|{delivery}")),
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

    /// Records that a signed, well-formed delivery reached this hook. It runs
    /// before the preset predicate on purpose: the registration panel asks
    /// "is the sender reaching me", and a delivery the preset rejects answers
    /// that just as well as one that fires a run. Bookkeeping never fails a
    /// delivery.
    async fn stamp_delivery(&self, hook_id: &str, now_ms: i64) {
        let Some(at) = chrono::DateTime::from_timestamp_millis(now_ms) else {
            tracing::warn!(hook_id, now_ms, "webhook delivery: unrepresentable clock");
            return;
        };
        if let Err(err) = self.state.record_delivery(hook_id, &at.to_rfc3339()).await {
            tracing::warn!(hook_id, error = %err, "webhook delivery: recording the delivery time failed");
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

/// The screens a verified delivery still has to clear before it may run: the
/// preset predicate, the A7 staleness window, and the replay-dedup key it
/// yields on success.
fn screen(
    hook_id: &str,
    trigger: &WebhookTrigger,
    payload: &Value,
    headers: &WebhookHeaders,
    now_ms: i64,
) -> Result<String, WebhookDecision> {
    if let Some(preset) = trigger.preset
        && !match_preset(&preset_predicate(preset), payload)
    {
        return Err(WebhookDecision::PresetMismatch
            .rejected(hook_id, "payload does not match the trigger's preset"));
    }
    if let Some(timestamp) = delivery_timestamp_ms(payload, headers.timestamp.as_deref())
        && is_stale_delivery(timestamp, now_ms)
    {
        return Err(WebhookDecision::StaleDelivery.rejected(
            hook_id,
            "delivery is older than the 10-minute replay window",
        ));
    }
    delivery_id(payload, headers.github_delivery.as_deref()).ok_or_else(|| {
        WebhookDecision::MissingDeliveryId
            .rejected(hook_id, "no X-GitHub-Delivery header and no payload id")
    })
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T8.3), not a TS port
// confidence: high
// todos: 0
// notes: mirrors Node routes/automation-webhook.ts order (signature → JSON →
//        preset → staleness → delivery id → sample → enabled → start).
