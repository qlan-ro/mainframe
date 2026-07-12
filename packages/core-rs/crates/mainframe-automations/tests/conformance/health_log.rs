//! §12 Daily health log: a scheduled form pause whose answers feed two
//! run_action steps. Asserts the interaction row + event on pause, and that
//! ⟨mood⟩/⟨sleep⟩/⟨Today⟩ render into the notion.add_row + files.append params.

use crate::harness::Rig;
use mainframe_automations::store::RunStatus;
use serde_json::{Value, json};

fn field<'a>(params: &'a Value, key: &str) -> &'a str {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("<missing>")
}

#[tokio::test]
async fn health_log_form_answers_feed_notion_and_file_params() {
    let rig = Rig::completing("").await;
    let run_id = rig.start("daily-health-log").await;

    // The ask_me step pauses the run with a pending interaction row + event.
    rig.wait(&run_id, RunStatus::Waiting).await;
    let created = rig.sink.interactions_created();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].title, "Health check-in");
    let interaction = rig.pending().await;
    assert_eq!(interaction.run_id, run_id);

    // Answering resumes the run through both deterministic actions.
    rig.respond(
        &interaction.id,
        json!({ "mood": "great", "appetite": "normal", "sleep": 7, "symptoms": ["cough"] }),
    )
    .await;
    rig.wait(&run_id, RunStatus::Succeeded).await;
    assert!(
        rig.engine
            .list_pending_interactions()
            .await
            .unwrap()
            .is_empty()
    );

    // notion.add_row: ⟨Today⟩ + the form answers rendered into named columns.
    let notion = rig.recorded("notion.add_row");
    assert_eq!(notion.len(), 1);
    assert_eq!(field(&notion[0], "databaseId"), "Health Log");
    assert_eq!(field(&notion[0], "Date"), "2026-07-12");
    assert_eq!(field(&notion[0], "Mood"), "great");
    assert_eq!(field(&notion[0], "Sleep"), "7");
    assert_eq!(field(&notion[0], "Symptoms"), "cough");

    // files.append: the whole line rendered from the same tokens (~ path kept
    // verbatim — the fake action never touches the real filesystem).
    let file = rig.recorded("files.append");
    assert_eq!(file.len(), 1);
    assert_eq!(field(&file[0], "path"), "~/notes/kid-health-log.md");
    assert_eq!(
        field(&file[0], "content"),
        "2026-07-12 — mood: great, appetite: normal, sleep: 7h, symptoms: cough\n"
    );
}
