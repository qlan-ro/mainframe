use super::*;
use std::sync::Arc;

fn sink() -> (Arc<Mutex<Vec<DaemonEvent>>>, EmitSink) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let clone = Arc::clone(&seen);
    let emit: EmitSink = Arc::new(move |e| clone.lock().unwrap().push(e));
    (seen, emit)
}

#[test]
fn add_and_remove_panel_emit_events() {
    let (seen, emit) = sink();
    let ui = create_plugin_ui_context("todos", emit, None);
    let panel = ui.add_panel(UiZone::Fullview, "Tasks", Some("square-check"));
    ui.remove_panel(Some(&panel));
    let events = seen.lock().unwrap();
    assert!(matches!(
        events[0],
        DaemonEvent::PluginPanelRegistered { .. }
    ));
    assert!(matches!(
        events[1],
        DaemonEvent::PluginPanelUnregistered { .. }
    ));
}

#[tokio::test]
async fn notify_gate_drops_when_disabled() {
    let (seen, emit) = sink();
    let ui = create_plugin_ui_context("todos", emit, Some(Box::new(|| Box::pin(async { false }))));
    ui.notify(NotifyOptions {
        title: "t".into(),
        body: "b".into(),
        level: Some("success".into()),
    })
    .await;
    assert!(seen.lock().unwrap().is_empty());
}

#[test]
fn panel_registration_survives_a_poisoned_lock() {
    let (seen, emit) = sink();
    let ui = create_plugin_ui_context("todos", emit, None);
    std::thread::scope(|scope| {
        assert!(
            scope
                .spawn(|| {
                    let _guard = ui.active_panel_ids.lock().unwrap();
                    panic!("poison panel registry");
                })
                .join()
                .is_err()
        );
    });

    let panel = ui.add_panel(UiZone::Fullview, "Tasks", None);
    assert!(
        ui.active_panel_ids
            .lock()
            .unwrap_err()
            .into_inner()
            .contains(&panel)
    );
    ui.remove_panel(None);
    assert!(seen.lock().unwrap().iter().any(|event| matches!(
        event,
        DaemonEvent::PluginPanelUnregistered { panel_id: Some(id), .. } if id == &panel
    )));
}
