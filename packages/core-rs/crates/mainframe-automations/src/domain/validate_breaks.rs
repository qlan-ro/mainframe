//! Whether a `break` has anything coherent to leave (split out of
//! `validate.rs`, 300-line cap). Checked in its own pass because the
//! enclosing-block question is structural — it has nothing to do with the
//! token scope `scoped_walk::walk_scoped` threads.

use super::step::{ScopeRule, Step};
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
            _ => {
                // A parallel branch is ALWAYS concurrent, unlike a repeat,
                // which only is at concurrency > 1. A retry is not a loop: a
                // break inside one targets whatever loop encloses the retry.
                let nested_context = match step.scope_rule() {
                    ScopeRule::Repeat { concurrent: true } | ScopeRule::Parallel => {
                        BreakContext::ConcurrentBranch
                    }
                    ScopeRule::Repeat { concurrent: false } | ScopeRule::Loop => BreakContext::Loop,
                    ScopeRule::Leaf | ScopeRule::If | ScopeRule::Retry => context,
                };
                for body in step.child_bodies() {
                    walk(body, nested_context, ctx);
                }
            }
        }
    }
}
