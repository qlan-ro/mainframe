//! `build_handoff` end to end: coverage header, budget invariant, refusal.

use std::collections::HashSet;

use mainframe_types::segment::HandoffStrategy;

use super::*;
use crate::handoff::{HandoffIdentity, HandoffTooLarge, SpanInput, build_handoff, strip_marker};

fn identity() -> HandoffIdentity {
    HandoffIdentity {
        segment_marker: "seg_1".into(),
        handoff_id: "ho_1".into(),
        strategy: HandoffStrategy::Full,
        title: "Chat".into(),
        chat_id: "chat_1".into(),
        read_chat_available: false,
    }
}

fn history() -> Vec<ChatMessage> {
    (1..=20)
        .flat_map(|n| {
            vec![
                user(
                    &format!("u{n}"),
                    &format!("question {n} {}", "q".repeat(200)),
                ),
                assistant(&format!("a{n}"), &format!("answer {n} {}", "a".repeat(200))),
            ]
        })
        .collect()
}

#[test]
fn everything_fits_under_a_generous_budget() {
    let messages = history();
    let spans = [SpanInput {
        provider: "Claude",
        messages: &messages,
        covered: true,
    }];
    let built = build_handoff(&identity(), &spans, &HashSet::new(), 64_000).unwrap();
    assert_eq!((built.item_count, built.omitted_count), (40, 0));
    assert!(
        built
            .block
            .contains("Earlier turns 1–20 ran in Claude. You have not seen them.")
    );
    assert!(built.block.contains("Below are 40 of 40 items"));
}

#[test]
fn a_tight_budget_omits_items_and_never_exceeds_it() {
    let messages = history();
    let spans = [SpanInput {
        provider: "Claude",
        messages: &messages,
        covered: true,
    }];
    for budget in [1_500u64, 3_000, 5_000] {
        let built = build_handoff(&identity(), &spans, &HashSet::new(), budget).unwrap();
        assert!(
            built.used_bytes <= budget,
            "used {} > budget {budget}",
            built.used_bytes
        );
        assert!(built.omitted_count > 0);
        assert_eq!(built.item_count + built.omitted_count, 40);
        let header = format!("Below are {} of 40 items", built.item_count);
        assert!(built.block.contains(&header));
        // The last user message always wins a slot first.
        assert!(built.block.contains("question 20"));
    }
}

#[test]
fn a_header_that_cannot_fit_refuses_the_send() {
    let messages = history();
    let spans = [SpanInput {
        provider: "Claude",
        messages: &messages,
        covered: true,
    }];
    assert_eq!(
        build_handoff(&identity(), &spans, &HashSet::new(), 100),
        Err(HandoffTooLarge)
    );
}

#[test]
fn the_built_block_strips_back_to_the_user_message() {
    let messages = history();
    let spans = [SpanInput {
        provider: "Claude",
        messages: &messages,
        covered: true,
    }];
    let built = build_handoff(&identity(), &spans, &HashSet::new(), 4_000).unwrap();
    let sent = crate::handoff::render::prepend_block(&built.block, "next step");
    assert_eq!(strip_marker(&sent), "next step");
}
