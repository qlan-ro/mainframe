use super::*;
use serde_json::json;

pub(super) const SESSION: &str = "session";

pub(super) fn stamp(n: usize) -> String {
    format!("2026-09-25T00:{:02}:{:02}Z", (n / 60) % 60, n % 60)
}

pub(super) fn user_text(n: usize, text: &str, extra: Value) -> String {
    let mut line = json!({
        "type": "user", "uuid": format!("u{n}"), "timestamp": stamp(n),
        "message": {"role": "user", "content": text},
    });
    merge(&mut line, extra);
    line.to_string()
}

pub(super) fn assistant(n: usize, api_id: &str, blocks: Value, extra: Value) -> String {
    let mut line = json!({
        "type": "assistant", "uuid": format!("a{n}"), "timestamp": stamp(n),
        "message": {"id": api_id, "role": "assistant", "content": blocks, "stop_reason": "end_turn"},
    });
    merge(&mut line, extra);
    line.to_string()
}

pub(super) fn tool_use(n: usize, id: &str, name: &str) -> String {
    assistant(
        n,
        &format!("msg-{id}"),
        json!([{"type": "tool_use", "id": id, "name": name, "input": {"n": n}}]),
        json!({}),
    )
}

pub(super) fn tool_result(n: usize, id: &str, extra: Value) -> String {
    let mut line = json!({
        "type": "user", "uuid": format!("r{n}"), "timestamp": stamp(n),
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": id, "content": format!("output {n}")}
        ]},
    });
    merge(&mut line, extra);
    line.to_string()
}

fn merge(target: &mut Value, extra: Value) {
    if let Some(extra) = extra.as_object() {
        for (key, value) in extra {
            target[key] = value.clone();
        }
    }
}

/// A transcript that exercises every join the loader performs. Calls and
/// their results are separated by `gap` filler lines so they land in
/// different batches when batches are small.
pub(super) fn synthetic(gap: usize) -> Vec<u8> {
    let filler = |n: usize| {
        assistant(
            n,
            &format!("fill-{n}"),
            json!([{"type": "text", "text": "x".repeat(300)}]),
            json!({}),
        )
    };
    let mut lines = vec![user_text(1, "start", json!({}))];
    let mut n = 10;
    for call in 0..12 {
        let id = format!("toolu_{call}");
        lines.push(tool_use(n, &id, "Read"));
        for _ in 0..gap {
            n += 1;
            lines.push(filler(n));
        }
        n += 1;
        lines.push(tool_result(n, &id, json!({})));
        n += 1;
    }
    // A sub-agent call whose result and progress arrive much later.
    lines.push(tool_use(n, "toolu_agent", "Agent"));
    for _ in 0..gap {
        n += 1;
        lines.push(filler(n));
    }
    n += 1;
    lines.push(json!({
        "type": "progress", "uuid": format!("p{n}"), "timestamp": stamp(n),
        "parentToolUseID": "toolu_agent",
        "data": {"type": "agent_progress", "message": {"type": "assistant", "message": {
            "id": "child-msg", "content": [{"type": "tool_use", "id": "child-tool", "name": "Grep", "input": {}}]
        }}},
    }).to_string());
    n += 1;
    lines.push(tool_result(
        n,
        "toolu_agent",
        json!({"toolUseResult": {
            "status": "completed", "agentId": "agent-1", "totalDurationMs": 42
        }}),
    ));
    n += 1;
    // Compaction boundary, summary and meta lines.
    lines.push(
        json!({"type": "system", "subtype": "compact_boundary", "uuid": format!("c{n}"),
        "timestamp": stamp(n), "content": "Conversation compacted",
        "compactMetadata": {"trigger": "auto", "preTokens": 1000}})
        .to_string(),
    );
    n += 1;
    lines.push(user_text(n, "summary", json!({"isCompactSummary": true})));
    n += 1;
    lines.push(user_text(n, "meta", json!({"isMeta": true})));
    n += 1;
    // Sidechain lines, duplicates (same uuid, same API message id), and a plan.
    lines.push(assistant(
        n,
        "side",
        json!([{"type": "text", "text": "side"}]),
        json!({"isSidechain": true}),
    ));
    n += 1;
    lines.push(assistant(
        n,
        "dup",
        json!([{"type": "text", "text": "dup"}]),
        json!({}),
    ));
    lines.push(assistant(
        n,
        "dup",
        json!([{"type": "text", "text": "dup"}]),
        json!({}),
    ));
    lines.push(assistant(
        n + 1,
        "dup",
        json!([{"type": "text", "text": "same api id"}]),
        json!({}),
    ));
    n += 2;
    lines.push(assistant(
        n,
        "skill",
        json!([{"type": "tool_use", "id": "toolu_skill",
        "name": "Skill", "input": {"skill": "review"}}]),
        json!({}),
    ));
    n += 1;
    lines.push(user_text(
        n,
        "plan",
        json!({"toolUseResult": {"plan": "p", "filePath": "plans/a.md"}}),
    ));
    // Malformed, blank, CRLF and unicode lines, then an unterminated tail.
    let mut text = lines.join("\n");
    text.push_str("\n{not json\n\n   \n[1,2\n\"é\"\r\n");
    text.push_str(&assistant(
        n + 5,
        "crlf",
        json!([{"type": "text", "text": "é crlf"}]),
        json!({}),
    ));
    text.push_str("\r\n");
    text.push_str(&assistant(
        n + 6,
        "tail",
        json!([{"type": "text", "text": "tail"}]),
        json!({}),
    ));
    text.into_bytes()
}

/// A budget private to one test, so parity cases never compete for workers.
pub(super) fn leaked_budget(workers: usize) -> &'static super::budget::Budget {
    Box::leak(Box::new(super::budget::Budget::new(workers)))
}
