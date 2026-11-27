use super::fixture::*;
use super::*;
use crate::history::parallel_fixture::SESSION;
use serde_json::json;

pub(super) fn task_transcript(create_in_window: bool) -> String {
    use crate::history::parallel_fixture::{assistant, tool_result};
    let mut build = Builder::default();
    build.turns(2).user("plan");
    let create = |build: &mut Builder| {
        build.n += 1;
        let line = assistant(
            build.n,
            "msg-mk",
            json!([{"type": "tool_use", "id": "mk", "name": "TaskCreate",
                "input": {"subject": "Write the plan"}}]),
            json!({}),
        );
        build.record(line, None);
        build.n += 1;
        let line = tool_result(build.n, "mk", json!({})).replace("output ", "Task #1 created ");
        build.record(line, None);
    };
    let update = |build: &mut Builder| {
        build.n += 1;
        let line = assistant(
            build.n,
            "msg-update",
            json!([{"type": "tool_use", "id": "upd", "name": "TaskUpdate",
                "input": {"taskId": "1", "status": "completed"}}]),
            json!({}),
        );
        build.record(line, None);
        build.result("upd");
    };
    create(&mut build);
    if create_in_window {
        update(&mut build);
        build.reply("planned").turns(3);
    } else {
        build.reply("planned").turns(3).user("later");
        update(&mut build);
        build.reply("done");
    }
    build.text()
}

#[tokio::test]
async fn a_task_update_whose_creation_is_in_the_window_matches_the_full_read() {
    let text = task_transcript(true);
    for read in READS {
        parity(&text, 5, read)
            .await
            .expect("the task is created in the window");
    }
}

#[tokio::test]
async fn a_task_update_whose_creation_is_before_the_cut_reads_the_whole_file() {
    let file = write(&task_transcript(false));
    // One turn holds only the update; the subject lives on the earlier call.
    let found = read_tail(
        &file.path,
        SESSION,
        &HashSet::new(),
        1,
        small(300),
        &mut Held::default(),
    )
    .unwrap();
    assert!(found.is_none());
}
