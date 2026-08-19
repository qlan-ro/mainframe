//! Whether a `break` has anything coherent to leave (split out of
//! `validate.rs`, 300-line cap). Checked in its own pass because the
//! enclosing-block question is structural — it has nothing to do with the
//! token scope `validate.rs`'s `walk` threads.

use super::step::Step;
use super::validate::Ctx;

/// What a `break` at some point in the tree would actually leave.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BreakContext {
    /// Nothing encloses it.
    None,
    /// An ordinary loop/repeat — a break targets it fine.
    Loop,
    /// Only a concurrent repeat branch encloses it — its siblings are still
    /// running, so there's no coherent "leave the loop" target.
    ConcurrentBranch,
}

pub(super) fn check_breaks(steps: &[Step], ctx: &mut Ctx) {
    walk(steps, BreakContext::None, ctx);
}

fn walk(steps: &[Step], context: BreakContext, ctx: &mut Ctx) {
    for step in steps {
        match step {
            Step::Break(_) if context == BreakContext::None => ctx.push(
                step.id(),
                "Put this inside a loop or repeat — there's nothing here for it to stop."
                    .to_string(),
            ),
            Step::Break(_) if context == BreakContext::ConcurrentBranch => ctx.push(
                step.id(),
                "A break can't leave a concurrent repeat — its siblings are still running."
                    .to_string(),
            ),
            Step::If(s) => {
                walk(&s.then, context, ctx);
                walk(&s.otherwise, context, ctx);
            }
            Step::Repeat(s) => {
                let next = if s.concurrency.is_some_and(|n| n > 1) {
                    BreakContext::ConcurrentBranch
                } else {
                    BreakContext::Loop
                };
                walk(&s.steps, next, ctx);
            }
            Step::Loop(s) => walk(&s.steps, BreakContext::Loop, ctx),
            // A retry is not a loop: a break inside one targets whatever loop
            // encloses the retry, so the context passes through unchanged.
            Step::Retry(s) => walk(&s.steps, context, ctx),
            // A parallel branch is ALWAYS concurrent — unlike Repeat, it has
            // no sequential form to fall back to — so every branch gets the
            // same ConcurrentBranch context Repeat only reaches at concurrency>1.
            Step::Parallel(s) => {
                for branch in &s.branches {
                    walk(branch, BreakContext::ConcurrentBranch, ctx);
                }
            }
            _ => {}
        }
    }
}
