//! Fan-out validation shared by Repeat's `concurrency` field (Phase 4a) and
//! Parallel's branch list (Phase 4b): both are "how many chats can this one
//! block open at once", and a block nested inside another concurrent block
//! multiplies rather than adds — one shared cap and one shared nested-product
//! check, so there is one model to learn instead of two. Split out of
//! validate.rs (300-line cap).

use super::validate::Ctx;

/// A wide-open fan-out is almost always a mistake (every branch opens its own
/// agent chat), not a deliberate choice — the cap forces a second look rather
/// than a silent 500-chat storm.
pub(super) const MAX_CONCURRENT_FANOUT: u32 = 32;

/// Repeat's `concurrency` field: absent is sequential (factor 1, nothing to
/// check); `1` is sequential too; `2..=32` fans out by that factor. Returns
/// the factor the caller multiplies into `enclosing_concurrency` for the
/// body's own nested check.
pub(super) fn repeat_concurrency_factor(
    step_id: &str,
    concurrency: Option<u32>,
    enclosing_concurrency: u32,
    ctx: &mut Ctx,
) -> u32 {
    let Some(concurrency) = concurrency else {
        return 1;
    };
    if !(1..=MAX_CONCURRENT_FANOUT).contains(&concurrency) {
        ctx.push(
            step_id,
            format!("Concurrency must be between 1 and {MAX_CONCURRENT_FANOUT}."),
        );
        return 1;
    }
    if concurrency <= 1 {
        return 1;
    }
    check_product(step_id, "repeat", enclosing_concurrency, concurrency, ctx);
    concurrency
}

/// Parallel's branch list: unlike Repeat, there is no "sequential" form to
/// opt out of — every branch always fans out, so the factor is the branch
/// count itself once that count is in range.
pub(super) fn parallel_branch_factor(
    step_id: &str,
    branch_count: u32,
    enclosing_concurrency: u32,
    ctx: &mut Ctx,
) -> u32 {
    if branch_count < 2 {
        ctx.push(
            step_id,
            "A parallel block needs at least 2 branches.".to_string(),
        );
        return 1;
    }
    if branch_count > MAX_CONCURRENT_FANOUT {
        ctx.push(
            step_id,
            format!("A parallel block can have at most {MAX_CONCURRENT_FANOUT} branches."),
        );
        return 1;
    }
    check_product(
        step_id,
        "parallel block",
        enclosing_concurrency,
        branch_count,
        ctx,
    );
    branch_count
}

/// A concurrent block's factor multiplies onto every ancestor concurrent
/// block's own factor — a repeat two levels deep inside two `concurrency:32`
/// repeats can open 1024 chats, not 32, and neither ancestor alone can see
/// that. Out-of-range counts skip this (they already have their own error;
/// multiplying by a number already flagged as wrong would just add noise).
fn check_product(
    step_id: &str,
    noun: &str,
    enclosing_concurrency: u32,
    factor: u32,
    ctx: &mut Ctx,
) {
    let product = enclosing_concurrency.saturating_mul(factor);
    if product <= MAX_CONCURRENT_FANOUT {
        return;
    }
    ctx.push(
        step_id,
        format!(
            "This {noun} is nested inside another concurrent repeat or parallel block — \
             together they could open {product} chats at once. Keep the product at or under \
             {MAX_CONCURRENT_FANOUT}."
        ),
    );
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md Phase 4a/4b), not a TS port
// confidence: high
// todos: 0
// notes: split out of validate.rs once Parallel's branch-count check pushed
//        it over the 300-line cap; message wording is a deliberate superset
//        of the Phase 4a repeat-only text (existing tests assert substrings
//        that both still contain).
