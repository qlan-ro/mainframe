//! T5.2 — notify verb: rendered message + links (runId, chatIds from the
//! checkpoint's agent steps) reach the Notifier; notifier failure is
//! best-effort (logs, step still succeeds).

use std::sync::{Arc, Mutex};

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep, Step};
use crate::ports::{AgentOutcome, Notification, Notifier, NotifyError};
use crate::store::{AutomationStore, RunStatus, StepStatus};

use super::agent::AgentVerb;
use super::agent_test_support::{FakeAgentPort, wait_for_run};
use super::notify_verb::NotifyVerb;
use super::test_support::{FakePorts, definition, harness, manual, notify_step, text, token};
use super::{BoxFuture, Interpreter, StepOutcome, VerbContext, VerbPorts};

#[derive(Default)]
struct FakeNotifier {
    notifications: Mutex<Vec<Notification>>,
    fail: bool,
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

/// ask_agent and notify are both REAL; ask_me/run_action fall back.
struct WiredPorts {
    agent: Arc<AgentVerb>,
    notify: Arc<NotifyVerb>,
    fallback: FakePorts,
}

impl VerbPorts for WiredPorts {
    fn ask_agent<'a>(
        &'a self,
        step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let agent = self.agent.clone();
        Box::pin(async move { agent.execute(step, ctx).await })
    }

    fn ask_me<'a>(
        &'a self,
        step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        self.fallback.ask_me(step, ctx)
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
        let verb = self.notify.clone();
        Box::pin(async move { verb.execute(step, ctx).await })
    }
}

struct Rig {
    h: super::test_support::Harness,
    port: Arc<FakeAgentPort>,
    notifier: Arc<FakeNotifier>,
    engine: Arc<Interpreter>,
    _agent: Arc<AgentVerb>,
}

async fn rig(notifier_fails: bool) -> Rig {
    let h = harness().await;
    let port: Arc<FakeAgentPort> = Arc::new(FakeAgentPort::default());
    let agent = AgentVerb::new(port.clone(), h.store.clone(), h.sink.clone());
    let notifier = Arc::new(FakeNotifier {
        fail: notifier_fails,
        ..FakeNotifier::default()
    });
    let notify = Arc::new(NotifyVerb::new(
        h.store.clone(),
        AutomationStore::new(h.db.clone()),
        notifier.clone(),
    ));
    let ports = WiredPorts {
        agent: agent.clone(),
        notify,
        fallback: FakePorts::default(),
    };
    let mut deps = h.deps(ports);
    deps.agent_waits = Some(agent.clone());
    let engine = Arc::new(Interpreter::new(deps));
    agent.bind_advancer(engine.clone());
    Rig {
        h,
        port,
        notifier,
        engine,
        _agent: agent,
    }
}

#[tokio::test]
async fn notify_delivers_rendered_body_with_run_and_chat_links() {
    let r = rig(false).await;
    let def = definition(vec![
        super::test_support::ask_agent_step("agent-1", false),
        notify_step(
            "done",
            vec![text("Review finished: "), token("agent-1", "result", None)],
        ),
    ]);
    let run = r
        .engine
        .start_run(&r.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    r.engine.advance(&run.id).await.unwrap();
    r.port.complete(
        "chat-1",
        Ok(AgentOutcome::Completed {
            final_text: "looks good".to_string(),
        }),
    );
    wait_for_run(&r.h.store, &run.id, |run| {
        run.status == RunStatus::Succeeded
    })
    .await;

    let notifications = r.notifier.notifications.lock().unwrap();
    assert_eq!(notifications.len(), 1);
    let notification = &notifications[0];
    assert_eq!(notification.title, "A");
    assert_eq!(notification.body, "Review finished: looks good");
    assert_eq!(notification.run_id, run.id);
    assert_eq!(notification.automation_id, r.h.automation_id);
    assert_eq!(notification.links.run_id, run.id);
    assert_eq!(notification.links.chat_ids, vec!["chat-1".to_string()]);
}

#[tokio::test]
async fn a_failing_notifier_never_fails_the_step() {
    let r = rig(true).await;
    let def = definition(vec![notify_step("done", vec![text("hello")])]);
    let run = r
        .engine
        .start_run(&r.h.automation_id, def, manual(), None)
        .await
        .unwrap();
    r.engine.advance(&run.id).await.unwrap();

    let finished = r.h.store.get_run(&run.id).await.unwrap().unwrap();
    assert_eq!(finished.status, RunStatus::Succeeded);
    let entry = &finished.checkpoint.steps["done"];
    assert_eq!(entry.status, StepStatus::Succeeded);
    assert_eq!(entry.outputs.as_ref().unwrap().len(), 0);
    assert_eq!(r.notifier.notifications.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn notify_for_a_missing_run_fails_with_a_clear_error() {
    let h = harness().await;
    let notifier = Arc::new(FakeNotifier::default());
    let verb = NotifyVerb::new(
        h.store.clone(),
        AutomationStore::new(h.db.clone()),
        notifier.clone(),
    );
    let scope = crate::tokens::Scope::root(Arc::new(super::test_support::FakeClock));
    let ctx = VerbContext {
        run_id: "missing-run",
        step_ref: "done",
        scope: &scope,
    };
    let Step::Notify(step) = notify_step("done", vec![text("x")]) else {
        unreachable!()
    };
    let outcome = verb.execute(&step, ctx).await;
    assert_eq!(
        outcome,
        StepOutcome::Failed {
            error: "automation run not found: missing-run".to_string()
        }
    );
    assert!(notifier.notifications.lock().unwrap().is_empty());
}
