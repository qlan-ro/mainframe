//! Locates the nearest enclosing concurrent-repeat branch for a checkpoint
//! ref (engine MUST-FIX 3): an out-of-band failure (agent settle, deadline)
//! never walks through `engine::blocks_concurrent`'s own driver, so it has
//! no other way to learn which branch marker it must fail itself.

use super::step::{ScopeRule, Step, find_step_by_id};

/// `(block_id, branch_ref_suffix)` of the innermost concurrent block (a
/// `parallel`, or a `repeat` with `concurrency > 1`) enclosing `step_id`, if
/// any. `ref_suffix` is the `#<i>` chain
/// a checkpoint ref carries once `step_id`'s own id prefix is stripped off
/// (`walk.rs` builds every ref as `step.id() + frame.ref_suffix`).
///
/// Only the innermost match is returned: an outer concurrent Repeat's own
/// branch marker still gets written the ordinary way, the next time
/// `advance()` re-walks through it and finds this inner failure.
pub(crate) fn enclosing_concurrent_branch(
    steps: &[Step],
    step_id: &str,
    ref_suffix: &str,
) -> Option<(String, String)> {
    if steps.iter().any(|s| s.id() == step_id) {
        return None; // directly present at this level — nothing consumed a segment for it
    }
    for step in steps {
        for body in step.child_bodies() {
            if find_step_by_id(body, step_id).is_none() {
                continue;
            }
            let rule = step.scope_rule();
            // `if` adds no frame, so it consumes no segment.
            if rule == ScopeRule::If {
                return enclosing_concurrent_branch(body, step_id, ref_suffix);
            }
            // Every other block consumes one segment. A deeper match carries
            // only its own levels' segments, so this level's is prepended as
            // the recursion unwinds, or the marker key would lose every
            // ancestor iteration once nesting runs more than one level deep.
            let (segment, rest) = split_first_segment(ref_suffix)?;
            if let Some((id, inner_suffix)) = enclosing_concurrent_branch(body, step_id, rest) {
                return Some((id, format!("{segment}{inner_suffix}")));
            }
            // Absent a deeper match, a concurrent block answers itself. A
            // `parallel` branch is always concurrent; `loop`, `retry` and a
            // sequential `repeat` never write a branch marker.
            if matches!(
                rule,
                ScopeRule::Parallel | ScopeRule::Repeat { concurrent: true }
            ) {
                return Some((step.id().to_string(), segment.to_string()));
            }
            return None;
        }
    }
    None
}

/// Peels one `#<i>` chain segment off the front — `"#0#2"` -> `("#0", "#2")`.
fn split_first_segment(suffix: &str) -> Option<(&str, &str)> {
    let rest = suffix.strip_prefix('#')?;
    let end = rest.find('#').unwrap_or(rest.len());
    Some((&suffix[..end + 1], &rest[end..]))
}

#[cfg(test)]
#[path = "concurrent_branch_tests.rs"]
mod tests;
