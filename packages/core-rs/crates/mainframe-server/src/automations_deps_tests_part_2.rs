#[test]
fn automation_events_map_onto_daemon_events_one_to_one() {
    let run = RunSummary {
        id: "run_1".to_string(),
        automation_id: "auto_1".to_string(),
        status: AutomationRunStatus::Running,
        trigger: RunTriggerSummary {
            kind: AutomationTriggerKind::Manual,
            tokens: None,
        },
        started_at: 1,
        finished_at: None,
        error: None,
    };
    let mapped = map_automation_event(AutomationEvent::RunUpdated { run: run.clone() });
    assert_eq!(mapped, DaemonEvent::AutomationRunUpdated { run });

    let mapped = map_automation_event(AutomationEvent::InteractionResolved {
        interaction_id: "int_1".to_string(),
        run_id: "run_1".to_string(),
    });
    assert_eq!(
        serde_json::to_value(&mapped).unwrap()["type"],
        "automation.interaction.resolved"
    );
    // The engine's own serde tag must agree with the DaemonEvent tag for
    // every variant — drift here would split the wire.
    let engine_event = AutomationEvent::Completed {
        automation_id: "a".to_string(),
        automation_name: "n".to_string(),
        run_id: "r".to_string(),
        status: mainframe_types::automation::AutomationCompletedStatus::Failed,
        result: "boom".to_string(),
    };
    let daemon_json = serde_json::to_value(map_automation_event(engine_event.clone())).unwrap();
    let engine_json = serde_json::to_value(&engine_event).unwrap();
    assert_eq!(daemon_json, engine_json);
}

#[tokio::test]
async fn notifier_broadcasts_the_ws_notification() {
    let (tx, mut rx) = broadcast::channel(16);
    let notifier = DaemonNotifier::new(tx, Arc::new(PushService::new()));
    notifier
        .notify(Notification {
            run_id: "run_1".to_string(),
            automation_id: "auto_1".to_string(),
            title: "Daily".to_string(),
            body: "done".to_string(),
            links: NotificationLinks {
                run_id: "run_1".to_string(),
                chat_ids: vec!["chat_1".to_string()],
            },
        })
        .await
        .unwrap();
    match rx.recv().await.unwrap() {
        DaemonEvent::AutomationNotification { run_id, links, .. } => {
            assert_eq!(run_id, "run_1");
            assert_eq!(links.chat_ids, vec!["chat_1"]);
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

#[tokio::test]
async fn event_sink_forwards_run_updates_to_the_bus() {
    let (tx, mut rx) = broadcast::channel(16);
    let sink = DaemonEventSink::new(tx);
    let run = sample_run_summary();
    sink.emit(AutomationEvent::RunUpdated { run: run.clone() });
    assert_eq!(
        rx.recv().await.unwrap(),
        DaemonEvent::AutomationRunUpdated { run }
    );
}

fn sample_run_summary() -> RunSummary {
    RunSummary {
        id: "run_9".to_string(),
        automation_id: "auto_9".to_string(),
        status: AutomationRunStatus::Waiting,
        trigger: RunTriggerSummary {
            kind: AutomationTriggerKind::Schedule,
            tokens: None,
        },
        started_at: 9,
        finished_at: None,
        error: None,
    }
}

#[tokio::test]
async fn event_source_projects_terminal_chat_updates_only() {
    let (tx, _rx) = broadcast::channel(16);
    let source = DaemonEventSource::spawn(tx.subscribe());
    let mut curated = source.subscribe();

    tx.send(updated("chat_1", None)).unwrap();
    tx.send(updated("chat_2", Some(ChatUpdatedReason::Error)))
        .unwrap();

    let event = tokio::time::timeout(Duration::from_secs(1), curated.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        event,
        CuratedEvent::SessionFinished {
            chat_id: "chat_2".to_string(),
            reason: "error".to_string(),
        }
    );
}
