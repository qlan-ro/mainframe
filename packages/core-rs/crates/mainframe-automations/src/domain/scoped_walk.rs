//! The one scope-threading walk over a step tree, shared by validation and the
//! runtime name index so the editor and the interpreter agree on which tokens
//! and `$name`s each step can see.

use super::scope::{TokenInfo, current_item_info, step_produces};
use super::step::{ScopeRule, Step};

/// Visits every step in authoring order with the scope it sees. `visit`
/// returns the value its bodies inherit (validation threads the enclosing
/// concurrency factor through it; callers with nothing to carry use `()`).
///
/// Each body walks a copy of the scope, so nothing produced inside a repeat,
/// loop, retry or parallel outlives it: a failed retry attempt or an earlier
/// loop pass must not hand a later step a value the run never settled on, and
/// no parallel branch sees a sibling's outputs. `repeat` bodies also see
/// `Current item`. Only `if` re-emits both branches' outputs to later
/// siblings, through `step_produces`.
pub(crate) fn walk_scoped<C: Copy>(
    steps: &[Step],
    scope: &mut Vec<TokenInfo>,
    carry: C,
    visit: &mut impl FnMut(&Step, &[TokenInfo], C) -> C,
) {
    for step in steps {
        let inherited = visit(step, scope, carry);
        for body in step.child_bodies() {
            let mut nested = scope.clone();
            if matches!(step.scope_rule(), ScopeRule::Repeat { .. }) {
                nested.push(current_item_info());
            }
            walk_scoped(body, &mut nested, inherited, visit);
        }
        scope.extend(step_produces(step));
    }
}
