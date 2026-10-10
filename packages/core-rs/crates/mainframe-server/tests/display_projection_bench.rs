//! Benchmark (`#[ignore]`d): old (full `prepare`/
//! `encode_revision`/`diff`/`record` every partial) vs. new
//! (`IncrementalProjector` + per-container `encode_container`/`apply`/
//! `record_delta`) per-partial cost, same active turn at 100/1,000/10,000
//! settled messages. Run `cargo test --release -p mainframe-server --test
//! display_projection_bench -- --ignored --nocapture` and paste the table
//! (with machine/OS/rustc/profile/iteration counts) into the PR description
//! — this file is evidence, not a pass/fail gate. Wall time only: counting
//! allocations needs a `#[global_allocator]`, and `unsafe` is forbidden
//! everywhere in these crates, integration tests included (`tools/verify-gate.sh`).

use std::collections::HashMap;
use std::time::Instant;

use mainframe_acp::RevisionLog;
use mainframe_acp::SessionState;
use mainframe_acp::encoder;
use mainframe_adapter_claude::messages::display_pipeline::prepare_messages_for_client;
use mainframe_adapter_claude::messages::incremental::IncrementalProjector;
use mainframe_chat::message_cache::MessageCache;
use mainframe_display::DisplayProjector;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::display::StreamingLeafKind;

const CHAT_ID: &str = "chat-1";

fn msg(id: &str, kind: ChatMessageType, content: Vec<MessageContent>) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: CHAT_ID.to_string(),
        r#type: kind,
        content,
        timestamp: format!("2026-01-01T00:00:00.{id}Z"),
        metadata: None,
    }
}

fn text_msg(id: &str, kind: ChatMessageType, text: &str) -> ChatMessage {
    msg(
        id,
        kind,
        vec![MessageContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
    )
}

fn assistant_with_tool_use(id: &str, text: &str, tool_id: &str) -> ChatMessage {
    let mut m = text_msg(id, ChatMessageType::Assistant, text);
    m.content
        .push(MessageContent::Node(MessageContentNode::ToolUse {
            timing: None,
            command_execution: None,
            id: tool_id.to_string(),
            name: "Bash".to_string(),
            input: HashMap::new(),
            parent_tool_use_id: None,
        }));
    m
}

fn tool_result_msg(id: &str, tool_id: &str) -> ChatMessage {
    msg(
        id,
        ChatMessageType::ToolResult,
        vec![MessageContent::Node(MessageContentNode::ToolResult {
            tool_use_id: tool_id.to_string(),
            content: "done".to_string(),
            is_error: false,
            structured_patch: None,
            original_file: None,
            modified_file: None,
            images: Vec::new(),
            parent_tool_use_id: None,
        })],
    )
}

fn settled_messages(count: usize) -> Vec<ChatMessage> {
    (0..count)
        .map(|i| {
            if i % 2 == 0 {
                text_msg(&format!("u{i}"), ChatMessageType::User, "hi")
            } else {
                text_msg(&format!("a{i}"), ChatMessageType::Assistant, "ok")
            }
        })
        .collect()
}

/// One partial's measured wall time.
#[derive(Clone, Copy)]
struct Sample {
    nanos: u128,
}

fn measure<R>(mut f: impl FnMut() -> R) -> Sample {
    let start = Instant::now();
    let _ = f();
    Sample {
        nanos: start.elapsed().as_nanos(),
    }
}

/// One old-pipeline partial over `raw` plus a synthetic `overlay` tail.
fn old_step(
    raw: &[ChatMessage],
    overlay: Option<&ChatMessage>,
    streaming: Option<StreamingLeafKind>,
    state: &mut SessionState,
    log: &mut RevisionLog,
) {
    let combined: Vec<ChatMessage> = match overlay {
        Some(o) => raw
            .iter()
            .cloned()
            .chain(std::iter::once(o.clone()))
            .collect(),
        None => raw.to_vec(),
    };
    let messages = prepare_messages_for_client(&combined, None);
    let items = encoder::encode_revision(&messages, streaming);
    state.diff(&items);
    log.record(&items);
}

fn run_old(settled_len: usize) -> Vec<Sample> {
    let settled = settled_messages(settled_len);
    let mut state = SessionState::new();
    let mut log = RevisionLog::new("epoch".to_string());
    let baseline = prepare_messages_for_client(&settled, None);
    let baseline_items = encoder::encode_revision(&baseline, None);
    state.diff(&baseline_items);
    log.record(&baseline_items);

    let mut raw = settled;
    let mut samples = Vec::new();
    let mut step = |raw: &[ChatMessage], overlay: Option<&ChatMessage>, streaming| {
        samples.push(measure(|| {
            old_step(raw, overlay, streaming, &mut state, &mut log)
        }));
    };

    raw.push(text_msg("u-act", ChatMessageType::User, "start the task"));
    step(&raw, None, None);
    for partial in ["I'll", "I'll check", "I'll check the file"] {
        let overlay = text_msg("a-act", ChatMessageType::Assistant, partial);
        step(&raw, Some(&overlay), Some(StreamingLeafKind::Text));
    }
    raw.push(assistant_with_tool_use(
        "a-act",
        "I'll check the file",
        "tu-act",
    ));
    step(&raw, None, None);
    raw.push(tool_result_msg("tr-act", "tu-act"));
    step(&raw, None, None);

    samples
}

fn make_projector() -> Box<dyn DisplayProjector> {
    Box::new(IncrementalProjector::new())
}

/// One new-pipeline partial: per-container encode/apply/record.
fn new_step(
    cache: &mut MessageCache,
    overlay: Option<&ChatMessage>,
    streaming: Option<StreamingLeafKind>,
    state: &mut SessionState,
    log: &mut RevisionLog,
) {
    let delta = cache.project_display(CHAT_ID, overlay, None, make_projector);
    let streaming_ordinal = delta.len.checked_sub(1);
    let changes = delta
        .changes
        .iter()
        .map(|(ordinal, message)| {
            let leaf = streaming.filter(|_| Some(*ordinal) == streaming_ordinal);
            (*ordinal, encoder::encode_container(message, leaf))
        })
        .collect();
    let encoded = mainframe_acp::encoder::delta::EncodedDelta {
        full: false,
        changes,
        len: delta.len,
    };
    state.apply(&encoded, || unreachable!("seeded"));
    log.record_delta(&encoded, || unreachable!("seeded"));
}

fn run_new(settled_len: usize) -> Vec<Sample> {
    let mut cache = MessageCache::new();
    for msg in settled_messages(settled_len) {
        cache.append(CHAT_ID, msg);
    }
    let baseline = cache.project_display(CHAT_ID, None, None, make_projector);
    let baseline_containers = encoder::encode_containers(&baseline.snapshot.materialize(), None);
    let mut state = SessionState::new();
    let mut log = RevisionLog::new("epoch".to_string());
    state.seed_containers(&baseline_containers);
    log.seed_containers(&baseline_containers);

    let mut samples = Vec::new();
    let mut step = |cache: &mut MessageCache,
                    overlay: Option<&ChatMessage>,
                    streaming: Option<StreamingLeafKind>| {
        samples.push(measure(|| {
            new_step(cache, overlay, streaming, &mut state, &mut log)
        }));
    };

    cache.append(
        CHAT_ID,
        text_msg("u-act", ChatMessageType::User, "start the task"),
    );
    step(&mut cache, None, None);
    for partial in ["I'll", "I'll check", "I'll check the file"] {
        let overlay = text_msg("a-act", ChatMessageType::Assistant, partial);
        step(&mut cache, Some(&overlay), Some(StreamingLeafKind::Text));
    }
    cache.append(
        CHAT_ID,
        assistant_with_tool_use("a-act", "I'll check the file", "tu-act"),
    );
    step(&mut cache, None, None);
    cache.append(CHAT_ID, tool_result_msg("tr-act", "tu-act"));
    step(&mut cache, None, None);

    samples
}

fn median_p95(mut nanos: Vec<u128>) -> (u128, u128) {
    nanos.sort_unstable();
    let median = nanos[nanos.len() / 2];
    let p95 = nanos[(nanos.len() * 95 / 100).min(nanos.len() - 1)];
    (median, p95)
}

/// Repeats `run` and reports median/p95 latency (ns) per step.
fn report(label: &str, settled_len: usize, run: impl Fn(usize) -> Vec<Sample>, iterations: usize) {
    let mut per_step_nanos: Vec<Vec<u128>> = Vec::new();
    for _ in 0..iterations {
        let samples = run(settled_len);
        if per_step_nanos.is_empty() {
            per_step_nanos = samples.iter().map(|_| Vec::new()).collect();
        }
        for (i, sample) in samples.iter().enumerate() {
            per_step_nanos[i].push(sample.nanos);
        }
    }
    for (i, nanos) in per_step_nanos.into_iter().enumerate() {
        let (median, p95) = median_p95(nanos);
        println!(
            "{label:<5} settled={settled_len:<6} step={i} median={median:>8}ns p95={p95:>8}ns"
        );
    }
}

/// Printed once so the PR description can carry it alongside the table.
fn print_conditions(iterations: usize) {
    println!(
        "conditions: os={} arch={} profile={} iterations={}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        iterations
    );
}

#[test]
#[ignore = "benchmark: run with --release --ignored --nocapture and report in the PR"]
fn old_vs_new_per_partial_cost() {
    let iterations = 20;
    print_conditions(iterations);
    for settled_len in [100usize, 1_000, 10_000] {
        report("old", settled_len, run_old, iterations);
        report("new", settled_len, run_new, iterations);
    }
}
