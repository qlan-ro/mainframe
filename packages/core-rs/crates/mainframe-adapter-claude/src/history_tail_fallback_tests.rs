use super::fixture::*;
use super::*;
use crate::history::parallel_fixture::{SESSION, assistant};
use mainframe_adapter_api::WindowRequest;
use serde_json::json;

#[tokio::test]
async fn a_result_split_from_its_call_by_the_cut_reads_the_whole_file() {
    let mut build = Builder::default();
    build
        .turns(5)
        .user("run it")
        .call("late")
        .reply("running")
        .user("next");
    build.reply("working").result("late").reply("done");
    let text = build.text();
    for read in READS {
        let file = write(&text);
        let found = read_tail(&file.path, SESSION, &HashSet::new(), 1, small(read)).unwrap();
        assert!(found.is_none(), "the cut would orphan the result");
    }
}

#[tokio::test]
async fn a_chain_that_leaves_the_tail_reads_the_whole_file() {
    // The reply's parent is a record before the cut, with no prompt on the way.
    let mut build = Builder::default();
    build.turns(4);
    build.raw(
        &json!({"type": "progress", "uuid": "step", "sessionId": SESSION,
        "parentUuid": null})
        .to_string(),
    );
    build.turns(3);
    let mut lines = build.lines.clone();
    let reply = assistant(
        950,
        "orphan",
        json!([{"type": "text", "text": "orphan reply"}]),
        json!({"sessionId": SESSION, "parentUuid": "missing-parent"}),
    );
    lines.push(reply);
    let file = write(&(lines.join("\n") + "\n"));
    let found = read_tail(&file.path, SESSION, &HashSet::new(), 2, small(400)).unwrap();
    assert!(found.is_none());
}

#[tokio::test]
async fn copied_history_from_another_session_reads_the_whole_file() {
    let mut build = Builder::default();
    build.turns(2);
    let mut other = build.lines.clone();
    for line in &mut other {
        *line = line.replace(
            &format!("\"sessionId\":\"{SESSION}\""),
            "\"sessionId\":\"before\"",
        );
    }
    let mut build = Builder::default();
    build.turns(6);
    let text = other.join("\n") + "\n" + &build.text();
    let file = write(&text);
    let found = read_tail(&file.path, SESSION, &HashSet::new(), 2, small(400)).unwrap();
    assert!(found.is_none(), "the tail names another session");
}

#[tokio::test]
async fn a_line_that_is_not_utf8_reads_the_whole_file() {
    let mut bytes = Builder::default().turns(4).text().into_bytes();
    bytes.extend_from_slice(b"\xff\xfe broken\n");
    bytes.extend(Builder::default().turns(3).text().into_bytes());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.jsonl");
    std::fs::write(&path, bytes).unwrap();
    let path = path.to_str().unwrap();
    // The cut would sit past the bad line, where the full read never gets.
    let found = read_tail(path, SESSION, &HashSet::new(), 6, small(700)).unwrap();
    assert!(found.is_none());
    // A cut after it is safe: the bad line lies before the read.
    let found = read_tail(path, SESSION, &HashSet::new(), 2, small(700)).unwrap();
    assert!(found.is_some());
}

#[tokio::test]
async fn a_record_without_a_uuid_or_time_reads_the_whole_file() {
    for strip in ["uuid", "timestamp"] {
        let mut build = Builder::default();
        build.turns(4).user("odd");
        let mut line: Value = serde_json::from_str(build.lines.last().unwrap()).unwrap();
        line.as_object_mut().unwrap().remove(strip);
        *build.lines.last_mut().unwrap() = line.to_string();
        build.reply("fine").turns(4);
        let file = write(&build.text());
        let found = read_tail(&file.path, SESSION, &HashSet::new(), 6, small(300)).unwrap();
        assert!(found.is_none(), "the loader would invent a {strip}");
    }
}

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
    let found = read_tail(&file.path, SESSION, &HashSet::new(), 1, small(300)).unwrap();
    assert!(found.is_none());
}

#[tokio::test]
async fn a_short_file_or_one_with_few_prompts_reads_the_whole_file() {
    let file = write(&Builder::default().turns(3).text());
    let few = read_tail(&file.path, SESSION, &HashSet::new(), 16, small(1 << 20)).unwrap();
    assert!(few.is_none(), "fewer prompts than the window needs");
    let file = write(&Builder::default().turns(30).text());
    let short = read_tail(&file.path, SESSION, &HashSet::new(), 2, Limits::PRODUCTION).unwrap();
    assert!(
        short.is_none(),
        "below the size a tail read is worth it for"
    );
}

#[tokio::test]
async fn answers_with_a_window_that_holds_enough_turns() {
    let file = write(&Builder::default().turns(60).text());
    let files = discovered(&file.path, &[]);
    let page = window(&files, 4, 10).await.expect("a window");
    assert!(page.older);
    let starts = prompts(&page.messages);
    assert!(
        (10..=16).contains(&starts),
        "grew from 4 to 8 to 16, got {starts}"
    );
    let full = full_read(&file.path).await;
    let start = full.len() - page.messages.len();
    assert_eq!(json_of(&page.messages), json_of(&full[start..]));
}

#[tokio::test]
async fn another_transcript_of_the_session_reads_the_whole_history() {
    let file = write(&Builder::default().turns(30).text());
    let sibling = write(&Builder::default().turns(2).text());
    let files = discovered(&file.path, &[&sibling.path]);
    assert!(window(&files, 4, 2).await.is_none());
    let mut partial = discovered(&file.path, &[]);
    partial.complete = false;
    assert!(window(&partial, 4, 2).await.is_none());
}

#[tokio::test]
async fn a_window_needing_more_than_the_file_allows_reads_the_whole_history() {
    let file = write(&Builder::default().turns(300).text());
    // Never enough: the request grows to its limit, then gives up.
    let asked = std::sync::atomic::AtomicUsize::new(0);
    let never = |_: &[ChatMessage]| {
        asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        false
    };
    let found = load_window_within(
        SESSION,
        &discovered(&file.path, &[]),
        WindowRequest {
            turns: 4,
            enough: &never,
        },
        small(700),
    )
    .await
    .unwrap();
    assert!(found.is_none());
    assert_eq!(
        asked.load(std::sync::atomic::Ordering::SeqCst),
        3,
        "bounded attempts"
    );
}

#[tokio::test]
async fn a_missing_file_reads_the_whole_history() {
    let files = discovered("/nonexistent/session.jsonl", &[]);
    assert!(window(&files, 4, 2).await.is_none());
}
