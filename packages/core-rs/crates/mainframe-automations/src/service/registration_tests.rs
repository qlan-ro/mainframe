//! T7 — webhook registration. The editor's panel asks four things: what URL
//! do I paste into GitHub, what do I sign with, is the hook armed, and has
//! anything ever arrived. Arming provisions and reveals the signing secret
//! (reads never carry it); the delivery stamp is read back from the store;
//! and a `registration` a client sends on save never lands in the definition,
//! so a stale save can't claim a hook is live.

use crate::credentials::CredentialKind;
use crate::domain::{
    AutomationCreateInput, AutomationDefinition, AutomationScope, Trigger, WebhookRegistration,
    WebhookTrigger,
};
use crate::engine::test_support::{notify_step, text};

use super::registration::WebhookState;
use super::service_tests::engine;

fn webhook_definition(registration: Option<WebhookRegistration>) -> AutomationDefinition {
    AutomationDefinition {
        triggers: vec![Trigger::Webhook(WebhookTrigger {
            id: "wt".to_string(),
            hook_id: "hook-1".to_string(),
            preset: None,
            registration,
        })],
        steps: vec![notify_step("n1", vec![text("pinged")])],
    }
}

fn create_input(definition: AutomationDefinition) -> AutomationCreateInput {
    AutomationCreateInput {
        name: "deploy watch".to_string(),
        description: None,
        scope: AutomationScope::Global,
        project_id: None,
        definition,
    }
}

fn stored_registration(definition: &AutomationDefinition) -> Option<&WebhookRegistration> {
    definition
        .triggers
        .iter()
        .find_map(|trigger| match trigger {
            Trigger::Webhook(hook) => hook.registration.as_ref(),
            _ => None,
        })
}

#[tokio::test]
async fn arming_provisions_the_signing_secret_and_reports_no_delivery_yet() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine
        .create(create_input(webhook_definition(None)))
        .await
        .unwrap();
    assert_eq!(engine.credential_kind("webhook:hook-1").await, None);

    let state = engine
        .arm_webhook(&created.id, "wt")
        .await
        .unwrap()
        .expect("the automation and its webhook trigger both exist");

    assert_eq!(state.hook_id, "hook-1");
    assert_eq!(
        state.last_delivery_at, None,
        "armed but never delivered is a real state the panel renders"
    );
    assert_eq!(
        engine.credential_kind("webhook:hook-1").await,
        Some(CredentialKind::Token)
    );
    assert_eq!(
        state.secret.as_deref(),
        engine
            .credentials
            .get("webhook:hook-1")
            .await
            .map(|c| c.token)
            .as_deref(),
        "arming hands back the provisioned secret — nothing else can, so a \
         hook whose secret stays hidden can never accept a delivery"
    );
}

#[tokio::test]
async fn re_arming_reveals_the_secret_already_handed_to_the_sender() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine
        .create(create_input(webhook_definition(None)))
        .await
        .unwrap();

    let first = engine
        .arm_webhook(&created.id, "wt")
        .await
        .unwrap()
        .unwrap();
    let second = engine
        .arm_webhook(&created.id, "wt")
        .await
        .unwrap()
        .unwrap();

    assert!(first.secret.is_some());
    assert_eq!(
        first.secret, second.secret,
        "re-opening the panel must reveal the same secret, not invalidate the \
         signature the sender is already computing"
    );
}

#[tokio::test]
async fn reading_a_registration_never_carries_the_secret() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine
        .create(create_input(webhook_definition(None)))
        .await
        .unwrap();
    engine.arm_webhook(&created.id, "wt").await.unwrap();

    let state = engine.webhook_state("hook-1").await.unwrap().unwrap();
    assert_eq!(
        state.secret, None,
        "the secret is revealed once, by the arming the user asked for"
    );
}

#[tokio::test]
async fn debug_formatting_redacts_the_secret() {
    let state = WebhookState {
        hook_id: "hook-1".to_string(),
        last_delivery_at: None,
        secret: Some("s3cr3t".to_string()),
    };

    let rendered = format!("{state:?}");
    assert!(
        !rendered.contains("s3cr3t"),
        "a signing key must not reach a log line through {{:?}}: {rendered}"
    );
    assert!(rendered.contains("[redacted]"));
}

#[tokio::test]
async fn an_unknown_automation_or_trigger_arms_nothing() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine
        .create(create_input(webhook_definition(None)))
        .await
        .unwrap();

    assert!(
        engine
            .arm_webhook("no-such-automation", "wt")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        engine
            .arm_webhook(&created.id, "no-such-trigger")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        engine.credential_kind("webhook:hook-1").await,
        None,
        "a miss must not provision a secret for a hook nobody asked about"
    );
}

#[tokio::test]
async fn webhook_state_reports_a_delivery_only_after_the_hook_is_armed() {
    let (engine, _sink, _dir) = engine().await;
    let created = engine
        .create(create_input(webhook_definition(None)))
        .await
        .unwrap();
    assert!(
        engine.webhook_state("hook-1").await.unwrap().is_none(),
        "an unarmed hook has no registration to report"
    );

    engine.arm_webhook(&created.id, "wt").await.unwrap();
    engine
        .webhook_deliveries
        .record_delivery("hook-1", "2026-07-12T11:30:00+00:00")
        .await
        .unwrap();

    let state = engine.webhook_state("hook-1").await.unwrap().unwrap();
    assert_eq!(state.hook_id, "hook-1");
    assert_eq!(
        state.last_delivery_at.as_deref(),
        Some("2026-07-12T11:30:00+00:00")
    );
}

#[tokio::test]
async fn a_client_sent_registration_never_reaches_the_stored_definition() {
    let (engine, _sink, _dir) = engine().await;
    let lie = WebhookRegistration {
        hook_id: "hook-1".to_string(),
        url: "https://elsewhere.test/hook".to_string(),
        last_delivery_at: Some("2099-01-01T00:00:00+00:00".to_string()),
    };

    let created = engine
        .create(create_input(webhook_definition(Some(lie.clone()))))
        .await
        .unwrap();
    assert_eq!(stored_registration(&created.definition), None);

    let updated = engine
        .update(&created.id, create_input(webhook_definition(Some(lie))))
        .await
        .unwrap();
    assert_eq!(stored_registration(&updated.definition), None);

    let reread = engine.get(&created.id).await.unwrap().unwrap();
    assert_eq!(
        stored_registration(&reread.definition),
        None,
        "registration is server-computed on read; storing it would let a stale save lie"
    );
}
