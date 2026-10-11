use super::*;

#[test]
fn an_agent_message_marker_titles_as_its_body() {
    let text = "<mainframe-agent-message from=\"abc\" kind=\"launch\">\nReview the diff\n</mainframe-agent-message>";
    assert_eq!(visible_message_text(text), "Review the diff");
    assert_eq!(unwrap_agent_message("plain"), "plain");
    assert_eq!(
        unwrap_agent_message("<mainframe-agent-message unterminated"),
        "<mainframe-agent-message unterminated"
    );
}

#[test]
fn strips_a_leading_run_of_reference_lines_plus_the_following_blank_line() {
    let text = "Referenced session @session[Foo]: /tmp/foo.jsonl\n\
Referenced session @session[Bar]: /tmp/bar.jsonl\n\n\
look at this";
    assert_eq!(strip_reference_lines(text), "look at this");
}

#[test]
fn strips_a_reference_run_that_starts_a_later_block() {
    let text = "/review\n\nReferenced session @session[Foo]: /tmp/foo.jsonl\n\nrest";
    assert_eq!(strip_reference_lines(text), "/review\n\nrest");
}

#[test]
fn leaves_a_reference_shaped_line_alone_when_preceded_by_a_non_empty_line() {
    let text = "some prose\nReferenced session @session[Foo]: /tmp/foo.jsonl\nmore prose";
    assert_eq!(strip_reference_lines(text), text);
}

#[test]
fn is_a_no_op_for_text_with_no_reference_lines() {
    let text = "just a plain message with @session[Foo] inline";
    assert_eq!(strip_reference_lines(text), text);
}

#[test]
fn returns_an_empty_string_for_text_that_is_only_reference_lines() {
    let text = "Referenced session @session[Foo]: /tmp/foo.jsonl\n\
Referenced session @session[Bar]: /tmp/bar.jsonl";
    assert_eq!(strip_reference_lines(text), "");
}

#[test]
fn round_trips_a_single_line_slash_body_byte_identically() {
    let prepended = "/review @session[Foo]\n\nReferenced session @session[Foo]: /tmp/foo.jsonl";
    assert_eq!(strip_reference_lines(prepended), "/review @session[Foo]");
}

#[test]
fn strips_the_capture_sentinel_header_and_rows_keeping_the_user_text() {
    let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n\
> - `element1` — selector `nav > .x`\n\
> - `screenshot1` — \"the gap\"\n\nfix the spacing";
    assert_eq!(strip_sandbox_capture_block(text), "fix the spacing");
}

#[test]
fn keeps_a_user_quote_that_follows_the_capture_rows() {
    let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1`\n> like this?";
    assert_eq!(strip_sandbox_capture_block(text), "> like this?");
}

#[test]
fn capture_strip_is_a_no_op_without_the_sentinel() {
    let text = "> **Preview captures**\n> - `element1`";
    assert_eq!(strip_sandbox_capture_block(text), text);
}

#[test]
fn visible_text_strips_both_fenced_blocks_from_one_body() {
    let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1`\n\n\
Referenced session @session[Foo]: /tmp/foo.jsonl\n\ncompare with @session[Foo]";
    assert_eq!(visible_message_text(text), "compare with @session[Foo]");
}

#[test]
fn visible_text_is_idempotent() {
    let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1`\n\nwhy?";
    let once = visible_message_text(text);
    assert_eq!(once, "why?");
    assert_eq!(visible_message_text(&once), once);
}
