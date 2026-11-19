use super::*;

fn assistant_line(text: &str) -> Vec<u8> {
    format!(
        "{}\n",
        serde_json::json!({
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": text}]}
        })
    )
    .into_bytes()
}

fn recorded_text(sink: &RecordingSink, index: usize) -> String {
    block_value(&sink.r().message_content[index], 0)["text"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn preserves_utf8_split_inside_each_multibyte_codepoint() {
    let text = "before — · 🦀 中文 after";
    let line = assistant_line(text);
    for (start, character) in String::from_utf8(line.clone()).unwrap().char_indices() {
        for offset in 1..character.len_utf8() {
            let s = session();
            let sink = RecordingSink::default();
            let split = start + offset;
            handle_stdout(&s, &line[..split], &sink);
            assert_eq!(sink.r().messages, 0);
            handle_stdout(&s, &line[split..], &sink);
            assert_eq!(sink.r().messages, 1);
            assert_eq!(recorded_text(&sink, 0), text);
        }
    }
}

#[test]
fn buffers_many_chunks_until_newline_and_emits_once() {
    let s = session();
    let sink = RecordingSink::default();
    let text = "— · 🦀 中文";
    let line = assistant_line(text);
    for chunk in line[..line.len() - 1].chunks(1) {
        handle_stdout(&s, chunk, &sink);
        assert_eq!(sink.r().messages, 0);
    }
    handle_stdout(&s, b"\n", &sink);
    assert_eq!(sink.r().messages, 1);
    assert_eq!(recorded_text(&sink, 0), text);
}

#[test]
fn replaces_invalid_utf8_and_continues_to_later_lines() {
    let s = session();
    let sink = RecordingSink::default();
    let mut invalid = assistant_line("invalid: X");
    let position = invalid.iter().position(|byte| *byte == b'X').unwrap();
    invalid[position] = 0xff;
    invalid.extend_from_slice(&assistant_line("valid 🦀"));
    handle_stdout(&s, &invalid, &sink);
    assert_eq!(sink.r().messages, 2);
    assert_eq!(recorded_text(&sink, 0), "invalid: \u{fffd}");
    assert_eq!(recorded_text(&sink, 1), "valid 🦀");
}

#[test]
fn preserves_utf8_across_an_eight_kib_read_with_a_partial_next_line() {
    let s = session();
    let sink = RecordingSink::default();
    let padding = 8192
        - assistant_line("🦀")
            .iter()
            .position(|byte| *byte == 0xf0)
            .unwrap()
        - 1;
    let text = format!("{}🦀", "a".repeat(padding));
    let mut lines = assistant_line(&text);
    lines.extend_from_slice(&assistant_line("next ·"));
    assert_eq!(lines[8191], 0xf0);
    handle_stdout(&s, &lines[..8192], &sink);
    assert_eq!(sink.r().messages, 0);
    handle_stdout(&s, &lines[8192..lines.len() - 1], &sink);
    assert_eq!(sink.r().messages, 1);
    assert_eq!(recorded_text(&sink, 0), text);
    handle_stdout(&s, b"\n", &sink);
    assert_eq!(sink.r().messages, 2);
    assert_eq!(recorded_text(&sink, 1), "next ·");
}
