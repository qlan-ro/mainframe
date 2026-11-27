use super::fixture::*;
use super::*;
use crate::history::parallel_fixture::{SESSION, assistant, tool_result, user_text};
use serde_json::json;

#[tokio::test]
async fn matches_the_full_window_at_every_turn_boundary() {
    let text = Builder::default().turns(24).text();
    for turns in [1, 2, 3, 5, 8, 13, 23, 24, 40] {
        for read in READS {
            let tail = parity(&text, turns, read)
                .await
                .expect("a plain file settles");
            assert_eq!(tail.older, turns < 24, "turns {turns}");
        }
    }
}

#[tokio::test]
async fn matches_with_replies_to_hidden_prompts() {
    let mut build = Builder::default();
    build.turns(3);
    for turn in 0..4 {
        build
            .user(&format!("ask {turn}"))
            .reply("started a task")
            .hidden_prompt()
            .reply("task result")
            .hidden_prompt()
            .reply("second task result");
    }
    build.turns(2);
    let text = build.text();
    for turns in 1..=9 {
        for read in READS {
            parity(&text, turns, read).await.expect("chains resolve");
        }
    }
}

#[tokio::test]
async fn groups_a_hidden_prompt_reply_as_the_full_read_does() {
    let mut build = Builder::default();
    build
        .turns(2)
        .user("go")
        .reply("ok")
        .hidden_prompt()
        .reply("late");
    let text = build.text();
    let tail = parity(&text, 1, 64).await.expect("settles");
    let late = tail.messages.last().unwrap();
    let meta = late.metadata.as_ref().unwrap();
    assert!(meta.contains_key(mainframe_types::transcript_presentation::TURN_GROUP_KEY));
    assert!(meta.contains_key(mainframe_types::transcript_presentation::HIDDEN_PROMPT_EVENT_KEY));
}

#[tokio::test]
async fn a_compaction_marker_leads_the_turn_after_it() {
    let mut build = Builder::default();
    build
        .turns(4)
        .compaction()
        .user("after")
        .reply("fine")
        .turns(2);
    let text = build.text();
    for turns in 1..=7 {
        for read in READS {
            let tail = parity(&text, turns, read).await.expect("settles");
            let first = tail.messages.first().unwrap();
            if turns == 3 {
                assert!(
                    is_compaction_marker(first),
                    "the marker comes with its turn"
                );
            }
        }
    }
}

#[tokio::test]
async fn matches_with_sidechain_meta_and_malformed_lines() {
    let mut build = Builder::default();
    build.turns(3);
    build.raw("{not json").raw("").raw("   ").raw("[1,2");
    build.user("one");
    let side = assistant(
        900,
        "side",
        json!([{"type": "text", "text": "side"}]),
        json!({"isSidechain": true, "sessionId": SESSION}),
    );
    build.raw(&side);
    let meta = user_text(901, "meta", json!({"isMeta": true, "sessionId": SESSION}));
    build.raw(&meta).raw("\"é\"").reply("done");
    build.turns(3);
    // An unterminated last line, as while the CLI is writing.
    let mut text = build.text();
    text.push_str("{\"type\":\"assistant\",\"uuid\":\"half");
    for turns in 1..=7 {
        for read in READS {
            parity(&text, turns, read).await.expect("settles");
        }
    }
}

#[tokio::test]
async fn matches_with_crlf_line_ends() {
    let text = Builder::default().turns(6).text().replace('\n', "\r\n");
    for turns in [1, 4] {
        parity(&text, turns, 300).await.expect("settles");
    }
}

#[tokio::test]
async fn matches_when_a_result_follows_its_call_inside_the_window() {
    let mut build = Builder::default();
    build
        .turns(5)
        .user("run it")
        .call("late")
        .reply("running")
        .user("next");
    build.reply("working").result("late").reply("done");
    let text = build.text();
    // Two turns hold the call and its late result.
    for read in READS {
        parity(&text, 2, read).await.expect("the call is inside");
    }
}

#[tokio::test]
async fn matches_with_a_sub_agent_launched_and_finished_in_the_window() {
    let mut build = Builder::default();
    build.turns(4).user("delegate");
    build.call("toolu_agent");
    build.raw(
        &json!({"type": "progress", "uuid": "progress-1", "sessionId": SESSION,
            "parentUuid": build.parent, "parentToolUseID": "toolu_agent",
            "data": {"type": "agent_progress", "message": {"type": "assistant", "message": {
                "id": "child-msg", "content": [
                    {"type": "tool_use", "id": "child-tool", "name": "Grep", "input": {}}]}}}})
        .to_string(),
    );
    build.n += 1;
    let line = tool_result(
        build.n,
        "toolu_agent",
        json!({"toolUseResult": {"status": "completed", "agentId": "agent-1", "totalDurationMs": 7}}),
    );
    build.record(line, None).reply("delegated").turns(2);
    let text = build.text();
    for turns in 1..=7 {
        for read in READS {
            parity(&text, turns, read).await.expect("settles");
        }
    }
}

#[tokio::test]
async fn a_claude_session_answers_a_window_through_the_adapter_trait() {
    use mainframe_adapter_api::{Adapter, WindowRequest};
    let file = write(&Builder::default().turns(40).text());
    let base = std::path::Path::new(&file.path).parent().unwrap();
    let session = crate::adapter::ClaudeAdapter::default().create_session(
        mainframe_types::adapter::SessionOptions {
            project_path: base.to_string_lossy().into_owned(),
            chat_id: Some(SESSION.into()),
            session_file_path: Some(file.path.clone()),
            mainframe_chat_id: "chat".into(),
            fork_source: None,
        },
    );
    let enough = |messages: &[ChatMessage]| {
        messages
            .iter()
            .filter(|message| is_turn_start(message))
            .count()
            >= 10
    };
    let page = session
        .load_history_window(WindowRequest {
            turns: 16,
            enough: &enough,
        })
        .await
        .unwrap()
        .expect("the session pages its transcript");
    let full = session.load_history().await.unwrap();
    assert!(page.older);
    assert_eq!(
        json_of(&page.messages),
        json_of(&full[full.len() - page.messages.len()..])
    );
    assert_eq!(
        page.messages.iter().filter(|m| is_turn_start(m)).count(),
        16
    );
}
