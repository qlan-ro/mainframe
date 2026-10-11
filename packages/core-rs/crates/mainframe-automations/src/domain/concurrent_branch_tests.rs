use super::enclosing_concurrent_branch;
use crate::domain::{ParallelBlock, RepeatBlock, RetryBlock, Step, TokenRef};
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

fn parallel(id: &str, branches: Vec<Vec<Step>>) -> Step {
    Step::Parallel(ParallelBlock {
        id: id.to_string(),
        keep_going: false,
        branches,
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

#[test]
fn a_leaf_directly_in_a_parallel_branch_resolves_to_that_parallel() {
    let steps = vec![parallel(
        "split",
        vec![
            vec![ask_agent_step("agent", false)],
            vec![notify_step("ping", vec![])],
        ],
    )];
    assert_eq!(
        enclosing_concurrent_branch(&steps, "agent", "#0"),
        Some(("split".to_string(), "#0".to_string()))
    );
}

#[test]
fn nested_parallel_blocks_resolve_to_the_innermost_one() {
    let steps = vec![parallel(
        "outer",
        vec![vec![parallel(
            "inner",
            vec![
                vec![ask_agent_step("agent", false)],
                vec![notify_step("ping", vec![])],
            ],
        )]],
    )];
    assert_eq!(
        enclosing_concurrent_branch(&steps, "agent", "#0#0"),
        Some(("inner".to_string(), "#0#0".to_string()))
    );
}

#[test]
fn a_parallel_nested_inside_a_sequential_repeat_keeps_the_repeat_iteration_ancestor_segment() {
    let steps = vec![repeat(
        "outer",
        None,
        vec![parallel(
            "split",
            vec![
                vec![ask_agent_step("agent", false)],
                vec![notify_step("ping", vec![])],
            ],
        )],
    )];
    assert_eq!(
        enclosing_concurrent_branch(&steps, "agent", "#2#0"),
        Some(("split".to_string(), "#2#0".to_string())),
        "the repeat's own iteration segment (#2) must survive in the marker key, \
         not just the branch's own segment (#0)"
    );
}
