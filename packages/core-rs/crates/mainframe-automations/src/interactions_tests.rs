//! T5.1 — ask_me pause (pending interaction + event + notification) and
//! respond (validate → one-transaction claim → advance).

use std::sync::{Arc, Mutex};

use serde_json::{Map, Value, json};

use crate::domain::{
    AskAgentStep, AskMeStep, AutomationFormField, FormFieldType, NotifyStep, RunActionStep,
    ShowWhen, Step,
};
use crate::engine::test_support::{
    FakePorts, completed, definition, empty_outputs, harness, manual, text, token_ref,
};
use crate::engine::{BoxFuture, Interpreter, StepOutcome, VerbContext, VerbPorts};
use crate::interactions::{AskMeVerb, InteractionError, InteractionService, validate_form};
use crate::ports::{Notification, Notifier, NotifyError};
use crate::store::{InteractionStatus, RunStatus, StepStatus};

#[derive(Default)]
pub(crate) struct FakeNotifier {
    pub notifications: Mutex<Vec<Notification>>,
    pub fail: bool,
}

impl Notifier for FakeNotifier {
    fn notify(&self, notification: Notification) -> BoxFuture<'_, Result<(), NotifyError>> {
        self.notifications.lock().unwrap().push(notification);
        let fail = self.fail;
        Box::pin(async move {
            if fail {
                Err(NotifyError("push channel down".to_string()))
            } else {
                Ok(())
            }
        })
    }
}

struct AskMeWiredPorts {
    ask_me: Arc<AskMeVerb>,
    fallback: FakePorts,
}

impl VerbPorts for AskMeWiredPorts {
    fn ask_agent<'a>(
        &'a self,
        step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.ask_agent(step, ctx)
    }

    fn ask_me<'a>(
        &'a self,
        step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let verb = self.ask_me.clone();
        Box::pin(async move { verb.execute(step, ctx).await })
    }

    fn run_action<'a>(
        &'a self,
        step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.run_action(step, ctx)
    }

    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.notify(step, ctx)
    }
}

struct Rig {
    h: crate::engine::test_support::Harness,
    notifier: Arc<FakeNotifier>,
    engine: Arc<Interpreter>,
    service: InteractionService,
}

async fn rig_with(fallback: FakePorts, notifier_fails: bool) -> Rig {
    let h = harness().await;
    let notifier = Arc::new(FakeNotifier {
        fail: notifier_fails,
        ..FakeNotifier::default()
    });
    let ask_me = AskMeVerb::new(
        h.interactions.clone(),
        h.store.clone(),
        crate::store::AutomationStore::new(h.db.clone()),
        h.sink.clone(),
        notifier.clone(),
    );
    let ports = AskMeWiredPorts {
        ask_me: Arc::new(ask_me),
        fallback,
    };
    let engine = Arc::new(Interpreter::new(h.deps(ports)));
    let service = InteractionService::new(h.interactions.clone(), engine.clone(), h.sink.clone());
    Rig {
        h,
        notifier,
        engine,
        service,
    }
}

fn field(key: &str, field_type: FormFieldType) -> AutomationFormField {
    AutomationFormField {
        key: key.to_string(),
        field_type,
        label: None,
        options: None,
        required: None,
        show_when: None,
    }
}

fn form_fields() -> Vec<AutomationFormField> {
    vec![
        AutomationFormField {
            options: Some(vec!["great".to_string(), "bad".to_string()]),
            ..field("mood", FormFieldType::Choice)
        },
        field("sleep", FormFieldType::Number),
        AutomationFormField {
            required: Some(false),
            ..field("note", FormFieldType::Text)
        },
    ]
}

fn ask_me_def(fields: Vec<AutomationFormField>) -> Vec<Step> {
    vec![Step::AskMe(AskMeStep {
        id: "form-1".to_string(),
        keep_going: false,
        title: "Log your day".to_string(),
        fields,
    })]
}

fn payload(entries: &[(&str, Value)]) -> Map<String, Value> {
    entries
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

#[tokio::test]
async fn ask_me_parks_with_a_pending_interaction_event_and_notification() {
    let rig = rig_with(FakePorts::default(), false).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(ask_me_def(form_fields())),
            manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    let parked = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(parked.status, RunStatus::Waiting);
    let entry = &parked.checkpoint.steps["form-1"];
    assert_eq!(entry.status, StepStatus::Waiting);

    let pending = rig.h.interactions.list_pending().await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].run_id, run.id);
    assert_eq!(pending[0].step_ref, "form-1");
    assert_eq!(pending[0].title, "Log your day");
    assert_eq!(pending[0].fields, form_fields());
    assert_eq!(
        entry.interaction_id.as_deref(),
        Some(pending[0].id.as_str())
    );

    // Wire event: automation.interaction.created carries the summary.
    let created = rig.h.sink.interaction_created();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].id, pending[0].id);
    assert_eq!(created[0].status, InteractionStatus::Pending);

    // Best-effort notification: automation name + form title.
    {
        let notifications = rig.notifier.notifications.lock().unwrap();
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].title, "A");
        assert_eq!(notifications[0].body, "Log your day");
        assert_eq!(notifications[0].links.run_id, run.id);
    }

    // A second advance never duplicates the pending interaction.
    rig.engine.advance(&run.id).await.unwrap();
    assert_eq!(rig.h.interactions.list_pending().await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_failing_notifier_does_not_fail_the_pause() {
    let rig = rig_with(FakePorts::default(), true).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(ask_me_def(form_fields())),
            manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();

    assert_eq!(
        rig.h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );
    assert_eq!(rig.notifier.notifications.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn respond_claims_answers_in_one_transaction_and_resumes() {
    let resolved_mood = Arc::new(Mutex::new(None::<String>));
    let seen = resolved_mood.clone();
    let fallback = FakePorts {
        notify: Box::new(move |_, ctx| {
            let mood = ctx
                .scope
                .resolve(&token_ref("form-1", "mood", None))
                .map(|v| v.coerce_to_string());
            *seen.lock().unwrap() = mood;
            completed(empty_outputs())
        }),
        ..FakePorts::default()
    };
    let rig = rig_with(fallback, false).await;
    let mut steps = ask_me_def(form_fields());
    steps.push(Step::Notify(NotifyStep {
        id: "done".to_string(),
        keep_going: false,
        message: vec![text("x")],
    }));
    let run = rig
        .engine
        .start_run(&rig.h.automation_id, definition(steps), manual(), None)
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    let interaction = rig.h.interactions.list_pending().await.unwrap().remove(0);

    rig.service
        .respond(
            &interaction.id,
            payload(&[("mood", json!("great")), ("sleep", json!(7.5))]),
        )
        .await
        .unwrap();

    let finished = rig.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    let entry = &finished.checkpoint.steps["form-1"];
    assert_eq!(entry.status, StepStatus::Succeeded);
    let outputs = entry.outputs.as_ref().unwrap();
    assert_eq!(outputs["mood"], json!("great"));
    assert_eq!(outputs["sleep"], json!(7.5));

    assert_eq!(
        rig.h
            .interactions
            .get(&interaction.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        InteractionStatus::Answered
    );
    assert_eq!(resolved_mood.lock().unwrap().as_deref(), Some("great"));

    let resolved = rig.h.sink.interaction_resolved();
    assert_eq!(resolved, vec![(interaction.id.clone(), run.id.clone())]);
}

#[tokio::test]
async fn respond_reports_field_level_errors() {
    let rig = rig_with(FakePorts::default(), false).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(ask_me_def(form_fields())),
            manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    let interaction = rig.h.interactions.list_pending().await.unwrap().remove(0);

    let err = rig
        .service
        .respond(
            &interaction.id,
            payload(&[("mood", json!("meh")), ("sleep", json!("plenty"))]),
        )
        .await
        .unwrap_err();
    let InteractionError::Invalid { errors } = err else {
        panic!("expected Invalid, got {err:?}");
    };
    assert_eq!(
        errors,
        vec![
            "'mood' must be one of [\"great\",\"bad\"]".to_string(),
            "'sleep' must be a number".to_string(),
        ]
    );

    // The claim never happened: still pending, run still waiting.
    assert_eq!(
        rig.h
            .interactions
            .get(&interaction.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        InteractionStatus::Pending
    );
    assert_eq!(
        rig.h.store.get_run(&run.id).await.unwrap().unwrap().status,
        RunStatus::Waiting
    );
}

#[tokio::test]
async fn respond_twice_is_already_answered() {
    let rig = rig_with(FakePorts::default(), false).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(ask_me_def(vec![field("note", FormFieldType::Text)])),
            manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    let interaction = rig.h.interactions.list_pending().await.unwrap().remove(0);

    rig.service
        .respond(&interaction.id, payload(&[("note", json!("hi"))]))
        .await
        .unwrap();
    let err = rig
        .service
        .respond(&interaction.id, payload(&[("note", json!("again"))]))
        .await
        .unwrap_err();
    assert!(matches!(err, InteractionError::AlreadyAnswered));
}

#[tokio::test]
async fn respond_after_run_cancel_is_already_cancelled() {
    let rig = rig_with(FakePorts::default(), false).await;
    let run = rig
        .engine
        .start_run(
            &rig.h.automation_id,
            definition(ask_me_def(vec![field("note", FormFieldType::Text)])),
            manual(),
            None,
        )
        .await
        .unwrap();
    rig.engine.advance(&run.id).await.unwrap();
    let interaction = rig.h.interactions.list_pending().await.unwrap().remove(0);

    rig.engine.cancel_run(&run.id).await.unwrap();

    let err = rig
        .service
        .respond(&interaction.id, payload(&[("note", json!("late"))]))
        .await
        .unwrap_err();
    assert!(matches!(err, InteractionError::AlreadyCancelled));
}

#[tokio::test]
async fn respond_to_unknown_interaction_is_not_found() {
    let rig = rig_with(FakePorts::default(), false).await;
    let err = rig.service.respond("nope", Map::new()).await.unwrap_err();
    assert!(matches!(err, InteractionError::NotFound(_)));
}

// --- validate_form unit coverage (ported from Node ask-me.ts) ----------

#[test]
fn missing_required_fields_default_to_required() {
    // `required` absent = required (Node: `required !== false`).
    let errors = validate_form(&form_fields(), &Map::new());
    assert_eq!(
        errors,
        vec![
            "missing required field 'mood'".to_string(),
            "missing required field 'sleep'".to_string(),
        ]
    );
}

#[test]
fn show_when_hides_a_field_from_validation() {
    let fields = vec![
        AutomationFormField {
            options: Some(vec!["create new".to_string(), "skip".to_string()]),
            ..field("action", FormFieldType::Choice)
        },
        AutomationFormField {
            show_when: Some(ShowWhen {
                key: "action".to_string(),
                equals: "create new".to_string(),
            }),
            ..field("title", FormFieldType::Text)
        },
    ];
    let hidden = validate_form(&fields, &payload(&[("action", json!("skip"))]));
    assert!(hidden.is_empty());

    let visible = validate_form(&fields, &payload(&[("action", json!("create new"))]));
    assert_eq!(visible, vec!["missing required field 'title'".to_string()]);
}

#[test]
fn multi_fields_validate_arrays_and_option_membership() {
    let fields = vec![AutomationFormField {
        options: Some(vec!["a".to_string(), "b".to_string()]),
        ..field("tags", FormFieldType::Multi)
    }];
    assert_eq!(
        validate_form(&fields, &payload(&[("tags", json!("a"))])),
        vec!["'tags' must be an array".to_string()]
    );
    assert_eq!(
        validate_form(&fields, &payload(&[("tags", json!(["a", "c"]))])),
        vec!["'tags' contains invalid values: [\"c\"]".to_string()]
    );
    assert!(validate_form(&fields, &payload(&[("tags", json!(["a", "b"]))])).is_empty());
}

#[test]
fn textarea_and_text_require_strings() {
    let fields = vec![field("essay", FormFieldType::Textarea)];
    assert_eq!(
        validate_form(&fields, &payload(&[("essay", json!(4))])),
        vec!["'essay' must be a string".to_string()]
    );
}
