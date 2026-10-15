//! Seeded random sequence: a hand-rolled xorshift64 (the workspace has no
//! `proptest`) drives a mixed sequence of every mutation kind, relying on
//! `Harness::step`'s per-call equivalence assertion to catch any divergence
//! from the full pipeline.

use crate::{RawChange, RawChanges};

use super::harness::*;

struct Xorshift64(u64);

impl Xorshift64 {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
}

#[test]
fn a_seeded_random_mutation_sequence_stays_equivalent_to_the_full_pipeline() {
    let mut rng = Xorshift64::new(0x05ee_d376_cafe_babe);
    let mut h = Harness::with_categories(task_categories());
    let mut tool_seq = 0u64;

    for _ in 0..150 {
        run_one_step(&mut h, &mut rng, &mut tool_seq, false);
    }
}

/// The same mix with assistant messages spread over a few turn groups (and
/// some with unknown provenance), so turn boundaries land at random points
/// relative to appends, tool results, duration markers and nested patches.
#[test]
fn a_seeded_random_sequence_with_turn_groups_stays_equivalent() {
    let mut rng = Xorshift64::new(0x0394_7e11_b0a2_d0e5);
    let mut h = Harness::with_categories(task_categories());
    let mut tool_seq = 0u64;

    for _ in 0..200 {
        run_one_step(&mut h, &mut rng, &mut tool_seq, true);
    }
}

fn run_one_step(h: &mut Harness, rng: &mut Xorshift64, tool_seq: &mut u64, keyed: bool) {
    let choice = rng.below(6);
    let id = h.next_id();
    match choice {
        0 => {
            h.raw.push(user(&id, "hi"));
            step_appended(h);
        }
        1 => {
            *tool_seq += 1;
            let tool_id = format!("tu{tool_seq}");
            h.raw.push(assistant(&id, vec![tool_use(&tool_id, "Bash")]));
            assign_turn_group(h, rng, keyed);
            step_appended(h);
        }
        2 => {
            h.raw.push(assistant(&id, vec![text("partial")]));
            assign_turn_group(h, rng, keyed);
            step_appended(h);
        }
        3 => append_tool_result_for_last_tool_use(h, tool_seq),
        4 => nested_append_to_a_random_assistant_group(h, rng),
        _ => {
            h.raw.push(duration_marker(&id, 1000 + *tool_seq));
            step_appended(h);
        }
    }
}

fn assign_turn_group(h: &mut Harness, rng: &mut Xorshift64, keyed: bool) {
    let group = if keyed { rng.below(4) } else { 0 };
    if group == 0 {
        return;
    }
    if let Some(last) = h.raw.last_mut() {
        last.metadata.get_or_insert_default().insert(
            mainframe_types::transcript_presentation::TURN_GROUP_KEY.into(),
            serde_json::json!(format!("p{group}")),
        );
    }
}

fn step_appended(h: &mut Harness) {
    let mut changes = RawChanges::new();
    changes.push(RawChange::Appended);
    h.step(changes, None);
}

fn append_tool_result_for_last_tool_use(h: &mut Harness, tool_seq: &u64) {
    if *tool_seq == 0 {
        return;
    }
    let tool_id = format!("tu{tool_seq}");
    let id = h.next_id();
    h.raw
        .push(tool_result_msg(&id, vec![tool_result(&tool_id, "ok")]));
    step_appended(h);
}

/// Pick an existing assistant-shaped raw message and extend it in place —
/// `append_nested_live`'s shape, regardless of whether that message's group
/// is still the active tail or already settled.
fn nested_append_to_a_random_assistant_group(h: &mut Harness, rng: &mut Xorshift64) {
    let assistant_indices: Vec<usize> = h
        .raw
        .iter()
        .enumerate()
        .filter(|(_, m)| m.r#type == mainframe_types::chat::ChatMessageType::Assistant)
        .map(|(i, _)| i)
        .collect();
    if assistant_indices.is_empty() {
        return;
    }
    let idx = assistant_indices[rng.below(assistant_indices.len() as u64) as usize];
    h.raw[idx].content.push(text("nested text"));
    let mut changes = RawChanges::new();
    changes.push(RawChange::Nested(idx));
    h.step(changes, None);
}
