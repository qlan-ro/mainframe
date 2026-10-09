//! `select`: priority order, whole items, original order, widest header.

use super::*;
use crate::handoff::select::{HeaderTooLarge, item_cost, select};

fn items() -> Vec<HandoffItem> {
    vec![
        item(ItemKind::User, 1, "first question"),
        item(ItemKind::Assistant, 1, "first answer"),
        item(ItemKind::Command, 1, "$ ls"),
        item(ItemKind::User, 2, "second question"),
        item(ItemKind::Assistant, 2, "second answer"),
        item(ItemKind::FileChange, 2, "Edited /a.rs"),
    ]
}

fn cost(indices: &[usize]) -> u64 {
    let all = items();
    indices.iter().map(|i| item_cost(&all[*i])).sum()
}

#[test]
fn everything_fits_in_original_order() {
    let all = items();
    let s = select(&all, 10_000, |_, _| 0).unwrap();
    assert_eq!(s.items, all);
    assert_eq!(s.omitted, 0);
}

#[test]
fn priority_is_last_user_last_assistant_first_user_then_newest_back() {
    // Budget for exactly the three priority items.
    let budget = cost(&[3, 4, 0]);
    let s = select(&items(), budget, |_, _| 0).unwrap();
    let texts: Vec<&str> = s.items.iter().map(|i| i.text.as_str()).collect();
    assert_eq!(
        texts,
        ["first question", "second question", "second answer"]
    );
    assert_eq!(s.omitted, 3);

    // One more slot goes to the newest remaining item, not the oldest.
    let budget = cost(&[3, 4, 0, 5]);
    let s = select(&items(), budget, |_, _| 0).unwrap();
    assert!(s.items.iter().any(|i| i.text == "Edited /a.rs"));
    assert!(!s.items.iter().any(|i| i.text == "$ ls"));
}

#[test]
fn an_oversized_item_is_omitted_whole_while_smaller_ones_still_fit() {
    let mut all = items();
    all[4].text = "x".repeat(5_000);
    let budget = cost(&[0, 1, 2, 3, 5]);
    let s = select(&all, budget, |_, _| 0).unwrap();
    assert_eq!(s.omitted, 1);
    assert!(s.items.iter().all(|i| i.text.len() < 5_000));
}

#[test]
fn the_header_is_charged_with_the_widest_counters() {
    let seen = std::cell::Cell::new((0, 0));
    let _ = select(&items(), 10_000, |a, b| {
        seen.set((a, b));
        100
    });
    assert_eq!(seen.get(), (6, 6));
    let s = select(&items(), cost(&[3]) + 100, |_, _| 100).unwrap();
    assert_eq!(s.items.len(), 1);
}

#[test]
fn a_header_that_does_not_fit_is_an_error() {
    assert_eq!(select(&items(), 50, |_, _| 51), Err(HeaderTooLarge));
}
