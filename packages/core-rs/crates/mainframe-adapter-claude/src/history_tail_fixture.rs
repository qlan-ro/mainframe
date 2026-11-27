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

/// The first message of the last `turns` turns of `full`, with the markers
/// that lead it: the window the display rules ask for.
pub(super) fn window_start(full: &[ChatMessage], turns: usize) -> usize {
    let starts: Vec<usize> = (0..full.len())
        .filter(|&index| is_turn_start(&full[index]))
        .collect();
    let Some(&first) = starts.get(starts.len().saturating_sub(turns)) else {
        return 0;
    };
    let mut start = first;
    while start > 0 && is_compaction_marker(&full[start - 1]) {
        start -= 1;
    }
    start
}

/// The tail read for `turns`, which must equal the full read's window.
pub(super) async fn parity(text: &str, turns: usize, first_read: u64) -> Option<Tail> {
    let file = write(text);
    let tail = read_tail(&file.path, SESSION, &HashSet::new(), turns, first_read).unwrap()?;
    let full = full_read(&file.path).await;
    let start = window_start(&full, turns);
    assert_eq!(
        json_of(&tail.messages),
        json_of(&full[start..]),
        "turns {turns}, first read {first_read}"
    );
    assert_eq!(tail.older, start > 0);
    Some(tail)
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
    let enough = move |messages: &[ChatMessage]| {
        messages
            .iter()
            .filter(|message| is_turn_start(message))
            .count()
            >= need
    };
    load_window(
        SESSION,
        files,
        WindowRequest {
            turns,
            enough: &enough,
        },
    )
    .await
    .unwrap()
}
