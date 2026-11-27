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
        let found = read_tail(&file.path, SESSION, &HashSet::new(), 1, read).unwrap();
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
    let found = read_tail(&file.path, SESSION, &HashSet::new(), 2, 400).unwrap();
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
    let found = read_tail(&file.path, SESSION, &HashSet::new(), 2, 400).unwrap();
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
    let found = read_tail(path, SESSION, &HashSet::new(), 6, 700).unwrap();
    assert!(found.is_none());
    // A read that starts at the file's first line stops there as the full read does.
    let whole = read_tail(path, SESSION, &HashSet::new(), 20, 1 << 20)
        .unwrap()
        .unwrap();
    assert_eq!(json_of(&whole.messages), json_of(&full_read(path).await));
}

#[tokio::test]
async fn answers_with_a_window_that_holds_enough_turns() {
    let file = write(&Builder::default().turns(60).text());
    let files = discovered(&file.path, &[]);
    let page = window(&files, 4, 10).await.expect("a window");
    assert!(page.older);
    let starts = page.messages.iter().filter(|m| is_turn_start(m)).count();
    assert!(
        (10..=16).contains(&starts),
        "grew from 4 to 8 to 16, got {starts}"
    );
    let full = full_read(&file.path).await;
    let start = full.len() - page.messages.len();
    assert_eq!(json_of(&page.messages), json_of(&full[start..]));
}

#[tokio::test]
async fn a_short_file_comes_back_whole() {
    let file = write(&Builder::default().turns(3).text());
    let page = window(&discovered(&file.path, &[]), 16, 10)
        .await
        .expect("whole");
    assert!(!page.older);
    let full = full_read(&file.path).await;
    assert_eq!(json_of(&page.messages), json_of(&full));
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
    let never = |_: &[ChatMessage]| false;
    let found = load_window(
        SESSION,
        &discovered(&file.path, &[]),
        WindowRequest {
            turns: 4,
            enough: &never,
        },
    )
    .await
    .unwrap();
    assert!(found.is_none());
}

#[tokio::test]
async fn a_missing_file_reads_the_whole_history() {
    let files = discovered("/nonexistent/session.jsonl", &[]);
    assert!(window(&files, 4, 2).await.is_none());
}
