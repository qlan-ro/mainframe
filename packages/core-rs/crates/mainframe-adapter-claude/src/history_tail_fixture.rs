use super::*;
use crate::history::parallel::ParseMode;
use crate::history::parallel_fixture::{SESSION, assistant, tool_result, tool_use, user_text};
use mainframe_adapter_api::WindowRequest;
use serde_json::json;

/// A transcript built line by line, each record naming the one before it.
#[derive(Default)]
pub(super) struct Builder {
    pub(super) lines: Vec<String>,
    pub(super) parent: Option<String>,
    pub(super) n: usize,
}

impl Builder {
    pub(super) fn record(&mut self, line: String, prompt: Option<String>) -> &mut Self {
        let mut entry: Value = serde_json::from_str(&line).unwrap();
        entry["sessionId"] = json!(SESSION);
        entry["parentUuid"] = json!(self.parent);
        if let Some(prompt) = prompt {
            entry["promptId"] = json!(prompt);
        }
        self.parent = entry["uuid"].as_str().map(str::to_owned);
        self.lines.push(entry.to_string());
        self
    }

    pub(super) fn user(&mut self, text: &str) -> &mut Self {
        self.n += 1;
        let line = user_text(self.n, text, json!({}));
        self.record(line, Some(format!("prompt-{}", self.n)))
    }

    pub(super) fn reply(&mut self, text: &str) -> &mut Self {
        self.n += 1;
        let line = assistant(
            self.n,
            &format!("msg-{}", self.n),
            json!([{"type": "text", "text": text}]),
            json!({}),
        );
        self.record(line, None)
    }

    pub(super) fn call(&mut self, id: &str) -> &mut Self {
        self.n += 1;
        let line = tool_use(self.n, id, "Read");
        self.record(line, None)
    }

    pub(super) fn result(&mut self, id: &str) -> &mut Self {
        self.n += 1;
        let line = tool_result(self.n, id, json!({}));
        self.record(line, None)
    }

    pub(super) fn hidden_prompt(&mut self) -> &mut Self {
        self.n += 1;
        let body = "<task-notification><status>completed</status><summary>done</summary></task-notification>";
        let line = user_text(self.n, body, json!({"isMeta": true}));
        self.record(line, Some(format!("hidden-{}", self.n)))
    }

    pub(super) fn compaction(&mut self) -> &mut Self {
        self.n += 1;
        let line = json!({"type": "system", "subtype": "compact_boundary",
            "uuid": format!("c{}", self.n), "timestamp": "2026-09-25T00:00:00Z"});
        self.record(line.to_string(), None);
        self.n += 1;
        let line = user_text(self.n, "summary", json!({"isCompactSummary": true}));
        self.record(line, Some(format!("summary-{}", self.n)))
    }

    pub(super) fn raw(&mut self, line: &str) -> &mut Self {
        self.lines.push(line.to_owned());
        self
    }

    /// `turns` plain turns, each a prompt, a tool call and result, a reply.
    pub(super) fn turns(&mut self, turns: usize) -> &mut Self {
        for turn in 0..turns {
            let id = format!("toolu_{}_{}", self.n, turn);
            self.user(&format!("question {turn}"))
                .call(&id)
                .result(&id)
                .reply(&format!("answer {turn} {}", "x".repeat(40 * (turn % 5))));
        }
        self
    }

    pub(super) fn text(&self) -> String {
        self.lines.join("\n") + "\n"
    }
}

pub(super) struct Written {
    pub(super) _dir: tempfile::TempDir,
    pub(super) path: String,
}

pub(super) fn write(text: &str) -> Written {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.jsonl");
    std::fs::write(&path, text).unwrap();
    Written {
        path: path.to_str().unwrap().to_owned(),
        _dir: dir,
    }
}

pub(super) async fn full_read(path: &str) -> Vec<ChatMessage> {
    let files = DiscoveredFiles {
        primary_path: path.to_owned(),
        all_files: vec![path.to_owned()],
        subagent_files: HashSet::new(),
        complete: true,
    };
    let open = crate::history::reader::open_reader;
    let (rows, _) =
        history_worker::load_with_reader(SESSION, &files, "/base", true, ParseMode::serial(), open)
            .await
            .unwrap();
    rows
}

pub(super) fn json_of(messages: &[ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|message| serde_json::to_value(message).unwrap())
        .collect()
}

/// Prompts in `messages`: the user messages (the fixtures hold no steered ones).
pub(super) fn prompts(messages: &[ChatMessage]) -> usize {
    messages
        .iter()
        .filter(|message| message.r#type == mainframe_types::chat::ChatMessageType::User)
        .count()
}

/// Where the window of the last `turns` turns starts in `full`, worked out
/// from the transcript text alone: the message of the `turns`-th last plain
/// prompt line, with the compaction boundaries just before it.
pub(super) fn window_start(text: &str, full: &[ChatMessage], turns: usize) -> usize {
    let entries: Vec<Value> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let uuid = |entry: &Value| entry["uuid"].as_str().map(str::to_owned);
    let prompt_ids: Vec<String> = entries
        .iter()
        .filter(|entry| {
            entry["type"] == "user"
                && entry["message"]["content"].is_string()
                && !["isMeta", "isCompactSummary", "isSidechain"]
                    .iter()
                    .any(|flag| entry[*flag] == true)
        })
        .filter_map(uuid)
        .collect();
    let boundaries: HashSet<String> = entries
        .iter()
        .filter(|entry| entry["subtype"] == "compact_boundary")
        .filter_map(uuid)
        .collect();
    let Some(first) = prompt_ids.get(prompt_ids.len().saturating_sub(turns)) else {
        return 0;
    };
    let mut start = full.iter().position(|m| &m.id == first).unwrap();
    while start > 0 && boundaries.contains(&full[start - 1].id) {
        start -= 1;
    }
    start
}

/// The tail read for `turns`, which must equal the full read's window.
pub(super) async fn parity(text: &str, turns: usize, first_read: u64) -> Option<Vec<ChatMessage>> {
    let file = write(text);
    let tail = read_tail(
        &file.path,
        SESSION,
        &HashSet::new(),
        turns,
        small(first_read),
        &mut Held::default(),
    )
    .unwrap()?;
    let full = full_read(&file.path).await;
    let start = window_start(text, &full, turns);
    assert_eq!(
        json_of(&tail),
        json_of(&full[start..]),
        "turns {turns}, first read {first_read}"
    );
    assert!(start > 0, "a cut leaves older messages");
    Some(tail)
}

/// Limits for a small test file: any size is read from the end.
pub(super) fn small(first_read: u64) -> Limits {
    Limits {
        first_read,
        min_file: 0,
    }
}

pub(super) const READS: [u64; 5] = [1, 64, 700, 4096, 1 << 20];

pub(super) fn discovered(path: &str, siblings: &[&str]) -> DiscoveredFiles {
    let mut all_files = vec![path.to_owned()];
    all_files.extend(siblings.iter().map(|sibling| (*sibling).to_owned()));
    DiscoveredFiles {
        primary_path: path.to_owned(),
        all_files,
        subagent_files: HashSet::new(),
        complete: true,
    }
}

pub(super) async fn window(
    files: &DiscoveredFiles,
    turns: usize,
    need: usize,
) -> Option<HistoryPage> {
    let enough = move |messages: &[ChatMessage]| prompts(messages) >= need;
    load_window_within(
        SESSION,
        files,
        WindowRequest {
            turns,
            enough: &enough,
        },
        small(700),
    )
    .await
    .unwrap()
}

/// A transcript of about `megabytes`, mostly large tool results as in real sessions.
pub(super) fn generate(path: &std::path::Path, megabytes: usize) -> usize {
    use std::io::Write;
    let target = megabytes << 20;
    let mut out = std::io::BufWriter::new(std::fs::File::create(path).unwrap());
    let (mut written, mut turns) = (0, 0);
    let mut parent: Option<String> = None;
    while written < target {
        turns += 1;
        let id = format!("toolu_{turns}");
        let blob = "lorem ipsum dolor sit amet \\n ".repeat(1 + (turns * 37) % 600);
        let lines = [
            (
                user_text(
                    turns * 4,
                    &format!("prompt {turns} {}", "word ".repeat(20)),
                    json!({}),
                ),
                true,
            ),
            (tool_use(turns * 4 + 1, &id, "Bash"), false),
            (
                tool_result(
                    turns * 4 + 2,
                    &id,
                    json!({"toolUseResult": {"stdout": blob}}),
                ),
                false,
            ),
            (
                assistant(
                    turns * 4 + 3,
                    &format!("text-{turns}"),
                    json!([{"type": "text", "text": "answer ".repeat(1 + turns % 50)}]),
                    json!({}),
                ),
                false,
            ),
        ];
        for (line, prompt) in lines {
            let mut entry: Value = serde_json::from_str(&line).unwrap();
            entry["sessionId"] = json!(SESSION);
            entry["parentUuid"] = json!(parent);
            if prompt {
                entry["promptId"] = json!(format!("prompt-{turns}"));
            }
            parent = entry["uuid"].as_str().map(str::to_owned);
            let line = entry.to_string();
            out.write_all(line.as_bytes()).unwrap();
            out.write_all(b"\n").unwrap();
            written += line.len() + 1;
        }
    }
    out.flush().unwrap();
    turns
}
