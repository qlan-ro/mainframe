use super::*;

fn turn(id: &str, status: &str) -> ThreadReadTurn {
    ThreadReadTurn {
        id: id.to_string(),
        status: status.to_string(),
        items: Vec::new(),
        timing: Default::default(),
    }
}

// ---- last_completed_turn_id ----

#[test]
fn no_turns_gives_none() {
    assert_eq!(last_completed_turn_id(&[]), None);
}

#[test]
fn a_trailing_completed_turn_is_picked() {
    let turns = vec![turn("t1", "completed"), turn("t2", "completed")];
    assert_eq!(last_completed_turn_id(&turns), Some("t2".to_string()));
}

#[test]
fn a_trailing_in_progress_turn_is_skipped_in_favor_of_the_last_completed_one() {
    let turns = vec![turn("t1", "completed"), turn("t2", "inProgress")];
    assert_eq!(last_completed_turn_id(&turns), Some("t1".to_string()));
}

#[test]
fn every_turn_in_progress_gives_none() {
    let turns = vec![turn("t1", "inProgress")];
    assert_eq!(last_completed_turn_id(&turns), None);
}

#[test]
fn thread_not_loaded_maps_to_transcript_missing() {
    assert_eq!(
        map_pin_error("thread not loaded: abc-123"),
        ForkPinError::TranscriptMissing
    );
}

#[test]
fn no_rollout_found_maps_to_transcript_missing() {
    assert_eq!(
        map_pin_error("no rollout found for thread id abc-123"),
        ForkPinError::TranscriptMissing
    );
}

#[test]
fn an_unrelated_error_maps_to_failed() {
    assert_eq!(
        map_pin_error("boom"),
        ForkPinError::Failed("boom".to_string())
    );
}

// ---- turn_before_message ----

fn prompt_turn(id: &str, status: &str, message_id: &str) -> ThreadReadTurn {
    let mut t = turn(id, status);
    t.items = vec![ThreadItem::UserMessage(
        crate::item_types::UserMessageItem {
            id: message_id.to_string(),
            content: None,
            text: Some("hi".to_string()),
        },
    )];
    t
}

fn is_point_not_found(result: Result<String, ForkPinError>) -> bool {
    matches!(result, Err(ForkPinError::PointNotFound(_)))
}

#[test]
fn the_turn_before_the_messages_turn_is_pinned() {
    let turns = vec![
        prompt_turn("t1", "completed", "m1"),
        prompt_turn("t2", "completed", "m2"),
        prompt_turn("t3", "completed", "m3"),
    ];
    assert_eq!(turn_before_message(&turns, "m3"), Ok("t2".to_string()));
    assert_eq!(turn_before_message(&turns, "m2"), Ok("t1".to_string()));
}

#[test]
fn the_first_turn_is_point_not_found() {
    let turns = vec![
        prompt_turn("t1", "completed", "m1"),
        prompt_turn("t2", "completed", "m2"),
    ];
    assert!(is_point_not_found(turn_before_message(&turns, "m1")));
}

#[test]
fn an_absent_message_is_point_not_found() {
    let turns = vec![prompt_turn("t1", "completed", "m1")];
    assert!(is_point_not_found(turn_before_message(&turns, "nope")));
    assert!(is_point_not_found(turn_before_message(&[], "nope")));
}

#[test]
fn an_in_progress_previous_turn_is_point_not_found() {
    let turns = vec![
        prompt_turn("t1", "inProgress", "m1"),
        prompt_turn("t2", "completed", "m2"),
    ];
    assert!(is_point_not_found(turn_before_message(&turns, "m2")));
}

#[test]
fn a_later_in_progress_turn_does_not_block_an_earlier_cut() {
    let turns = vec![
        prompt_turn("t1", "completed", "m1"),
        prompt_turn("t2", "completed", "m2"),
        prompt_turn("t3", "inProgress", "m3"),
    ];
    assert_eq!(turn_before_message(&turns, "m2"), Ok("t1".to_string()));
}

#[test]
fn no_cut_keeps_the_last_completed_turn() {
    let turns = vec![turn("t1", "completed"), turn("t2", "inProgress")];
    assert_eq!(
        pinned_turn_id(Some(&turns), None),
        Ok(Some("t1".to_string()))
    );
}
