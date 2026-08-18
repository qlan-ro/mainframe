//! Locates the nearest enclosing concurrent-repeat branch for a checkpoint
//! ref (engine MUST-FIX 3): an out-of-band failure (agent settle, deadline)
//! never walks through `engine::blocks_concurrent`'s own driver, so it has
//! no other way to learn which branch marker it must fail itself.

use super::step::{RepeatBlock, Step, find_step_by_id};

/// `(block_id, branch_ref_suffix)` of the innermost concurrent (`concurrency
/// > 1`) Repeat enclosing `step_id`, if any. `ref_suffix` is the `#<i>` chain
/// a checkpoint ref carries once `step_id`'s own id prefix is stripped off
/// (`walk.rs` builds every ref as `step.id() + frame.ref_suffix`).
///
/// Only the innermost match is returned: an outer concurrent Repeat's own
/// branch marker still gets written the ordinary way, the next time
/// `advance()` re-walks through it and finds this inner failure.
pub fn enclosing_concurrent_branch(
    steps: &[Step],
    step_id: &str,
    ref_suffix: &str,
) -> Option<(String, String)> {
    if steps.iter().any(|s| s.id() == step_id) {
        return None; // directly present at this level — nothing consumed a segment for it
    }
    for step in steps {
        let found = match step {
            Step::If(block) => enclosing_concurrent_branch(&block.then, step_id, ref_suffix)
                .or_else(|| enclosing_concurrent_branch(&block.otherwise, step_id, ref_suffix)),
            Step::Repeat(block) if find_step_by_id(&block.steps, step_id).is_some() => {
                descend_repeat(block, step_id, ref_suffix)
            }
            Step::Loop(block) if find_step_by_id(&block.steps, step_id).is_some() => {
                descend_pass_through(&block.steps, step_id, ref_suffix)
            }
            Step::Retry(block) if find_step_by_id(&block.steps, step_id).is_some() => {
                descend_pass_through(&block.steps, step_id, ref_suffix)
            }
            _ => None,
        };
        if found.is_some() {
            return found;
        }
    }
    None
}

/// A Repeat consumes one segment and, absent a deeper concurrent match,
/// may itself be the answer. Either way, a match found deeper in the tree
/// only carries ITS OWN level's segment — this level's segment has to be
/// prepended as the recursion unwinds, or the marker key loses every
/// ancestor iteration once nesting runs more than one level deep.
fn descend_repeat(
    block: &RepeatBlock,
    step_id: &str,
    ref_suffix: &str,
) -> Option<(String, String)> {
    let (segment, rest) = split_first_segment(ref_suffix)?;
    if let Some((id, inner_suffix)) = enclosing_concurrent_branch(&block.steps, step_id, rest) {
        return Some((id, format!("{segment}{inner_suffix}")));
    }
    block
        .concurrency
        .is_some_and(|n| n > 1)
        .then(|| (block.id.clone(), segment.to_string()))
}

/// Loop/Retry consume one segment too, but never answer themselves — only a
/// Repeat writes a branch marker. Same ancestor-segment prepending as
/// `descend_repeat` applies here.
fn descend_pass_through(
    steps: &[Step],
    step_id: &str,
    ref_suffix: &str,
) -> Option<(String, String)> {
    let (segment, rest) = split_first_segment(ref_suffix)?;
    enclosing_concurrent_branch(steps, step_id, rest)
        .map(|(id, inner_suffix)| (id, format!("{segment}{inner_suffix}")))
}

/// Peels one `#<i>` chain segment off the front — `"#0#2"` -> `("#0", "#2")`.
fn split_first_segment(suffix: &str) -> Option<(&str, &str)> {
    let rest = suffix.strip_prefix('#')?;
    let end = rest.find('#').unwrap_or(rest.len());
    Some((&suffix[..end + 1], &rest[end..]))
}

#[cfg(test)]
mod tests {
    use super::enclosing_concurrent_branch;
    use crate::domain::{RepeatBlock, RetryBlock, Step, TokenRef};
    use crate::engine::test_support::{ask_agent_step, notify_step};

    fn repeat(id: &str, concurrency: Option<u32>, steps: Vec<Step>) -> Step {
        Step::Repeat(RepeatBlock {
            id: id.to_string(),
            keep_going: false,
            items: TokenRef {
                step_id: "trigger".to_string(),
                output: "items".to_string(),
                field: None,
            },
            concurrency,
            steps,
        })
    }

    fn retry(id: &str, steps: Vec<Step>) -> Step {
        Step::Retry(RetryBlock {
            id: id.to_string(),
            keep_going: false,
            max_attempts: 1,
            steps,
        })
    }

    #[test]
    fn a_leaf_directly_in_a_concurrent_branch_resolves_to_that_repeat() {
        let steps = vec![repeat(
            "fanout",
            Some(2),
            vec![ask_agent_step("agent", false)],
        )];
        assert_eq!(
            enclosing_concurrent_branch(&steps, "agent", "#0"),
            Some(("fanout".to_string(), "#0".to_string()))
        );
    }

    #[test]
    fn a_sequential_repeat_nested_inside_a_concurrent_branch_is_transparent() {
        let steps = vec![repeat(
            "fanout",
            Some(2),
            vec![repeat("inner", None, vec![ask_agent_step("agent", false)])],
        )];
        assert_eq!(
            enclosing_concurrent_branch(&steps, "agent", "#0#2"),
            Some(("fanout".to_string(), "#0".to_string()))
        );
    }

    #[test]
    fn nested_concurrent_repeats_resolve_to_the_innermost_one() {
        let steps = vec![repeat(
            "outer",
            Some(2),
            vec![repeat(
                "inner",
                Some(2),
                vec![ask_agent_step("agent", false)],
            )],
        )];
        assert_eq!(
            enclosing_concurrent_branch(&steps, "agent", "#1#0"),
            Some(("inner".to_string(), "#1#0".to_string()))
        );
    }

    #[test]
    fn a_leaf_outside_every_repeat_has_no_enclosing_branch() {
        let steps = vec![notify_step("ping", vec![])];
        assert_eq!(enclosing_concurrent_branch(&steps, "ping", ""), None);
    }

    #[test]
    fn a_concurrent_repeat_nested_inside_a_retry_keeps_the_retry_attempts_ancestor_segment() {
        let steps = vec![retry(
            "guard",
            vec![repeat(
                "fanout",
                Some(2),
                vec![ask_agent_step("agent", false)],
            )],
        )];
        assert_eq!(
            enclosing_concurrent_branch(&steps, "agent", "#2#1"),
            Some(("fanout".to_string(), "#2#1".to_string())),
            "the retry's own attempt segment (#2) must survive in the marker key, \
             not just the branch's own segment (#1)"
        );
    }
}
