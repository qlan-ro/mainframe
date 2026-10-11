//! `handoff_budget` and `native_used`.

use crate::handoff::budget::*;

fn input() -> BudgetInput {
    BudgetInput::default()
}

#[test]
fn a_known_window_caps_at_the_token_cap() {
    let i = BudgetInput {
        model_window: Some(200_000),
        ..input()
    };
    assert_eq!(handoff_budget(&i), HANDOFF_TOKEN_CAP);
}

#[test]
fn an_unknown_window_assumes_128k() {
    // 128k - 32k reserve - 100k used = -4k → 0 when fully used; with 90k
    // used there is 6k of room.
    let i = BudgetInput {
        native_used: 90_000,
        ..input()
    };
    assert_eq!(handoff_budget(&i), 128_000 - 32_000 - 90_000);
}

#[test]
fn native_max_caps_the_model_window() {
    let i = BudgetInput {
        model_window: Some(1_000_000),
        native_max: Some(40_000),
        ..input()
    };
    // 40k window, 16k reserve (max of 16k and 10k) → 24k room, capped at 16k.
    assert_eq!(handoff_budget(&i), HANDOFF_TOKEN_CAP);
    let tight = BudgetInput {
        native_used: 20_000,
        ..i
    };
    assert_eq!(handoff_budget(&tight), 4_000);
}

#[test]
fn images_and_files_take_their_allowances() {
    let base = BudgetInput {
        model_window: Some(64_000),
        native_used: 20_000,
        ..input()
    };
    // 64k - 16k reserve - 20k used = 28k → capped 16k; add 2 images + 1 file
    // (8192*2 + 4096 = 20480) → 7520.
    let with = BudgetInput {
        images: 2,
        files: 1,
        ..base
    };
    assert_eq!(handoff_budget(&with), 28_000 - 20_480);
}

#[test]
fn the_budget_saturates_at_zero() {
    let i = BudgetInput {
        model_window: Some(10_000),
        native_used: 50_000,
        ..input()
    };
    assert_eq!(handoff_budget(&i), 0);
}

#[test]
fn user_text_counts_against_the_room() {
    let i = BudgetInput {
        model_window: Some(40_000),
        user_text_bytes: 20_000,
        ..input()
    };
    assert_eq!(handoff_budget(&i), 4_000);
}

#[test]
fn native_used_prefers_total_then_input_then_a_text_estimate() {
    assert_eq!(native_used(Some(10), Some(20), 400), 10);
    assert_eq!(native_used(None, Some(20), 400), 20);
    assert_eq!(native_used(None, Some(0), 400), 100);
    assert_eq!(native_used(None, None, 400), 100);
}
