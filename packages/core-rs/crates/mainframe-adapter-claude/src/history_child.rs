use super::*;
use std::collections::VecDeque;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

use mainframe_adapter_api::AdapterError;
use mainframe_types::sync::LockExt as _;

type Messages = Arc<Vec<ChatMessage>>;
static PARSE_LOCKS: [Mutex<()>; 16] = [const { Mutex::new(()) }; 16];
static CACHE: LazyLock<Mutex<VecDeque<Arc<ChildEntry>>>> = LazyLock::new(Default::default);

#[derive(PartialEq, Eq)]
struct Stamp(u64, SystemTime);

impl Stamp {
    fn read(path: &Path) -> std::io::Result<Self> {
        let metadata = std::fs::symlink_metadata(path)?;
        if !metadata.is_file() {
            return Err(std::io::ErrorKind::NotFound.into());
        }
        Ok(Self(metadata.len(), metadata.modified()?))
    }
}

struct ChildEntry {
    path: String,
    stamp: Stamp,
    messages: Messages,
    facts: history_agent_facts::AgentFacts,
    agents: HashMap<String, String>,
}

pub(crate) fn load(discovered: DiscoveredFiles, id: &str) -> Result<Messages, AdapterError> {
    let path = resolve(&discovered, id)?;
    read(path)
}

fn resolve(discovered: &DiscoveredFiles, id: &str) -> Result<String, AdapterError> {
    let children = &discovered.subagent_files;
    if id.is_empty() {
        return Err(unavailable());
    }
    if let Some(path) = children.iter().find(|file| agent_id(file) == Some(id)) {
        return Ok(path.clone());
    }
    let mut agents = HashMap::new();
    for source in discovered.parent_files() {
        if visit_lines(source, |line| {
            if line.contains("\"agentId\"")
                && let Ok(entry) = serde_json::from_str(line)
            {
                capture_agent_id_mapping(&entry, &mut agents);
            }
        })
        .is_err()
        {
            continue;
        }
        if let Some(path) = children.iter().find(|file| {
            agent_id(file)
                .and_then(|agent| agents.get(agent))
                .is_some_and(|tool| tool == id)
        }) {
            return Ok(path.clone());
        }
    }
    Err(unavailable())
}

fn unavailable() -> AdapterError {
    AdapterError::Unavailable("Sub-agent transcript is unavailable")
}

fn agent_id(file: &str) -> Option<&str> {
    Path::new(file)
        .file_stem()?
        .to_str()?
        .strip_prefix("agent-")
}

fn read(path: String) -> Result<Messages, AdapterError> {
    let parsed = read_cached(path)?;
    if parsed.agents.is_empty() && !parsed.messages.iter().any(|row| row.content.iter().any(|block| {
        matches!(block, mainframe_types::chat::MessageContent::Node(mainframe_types::chat::MessageContentNode::ToolUse { name, .. }) if matches!(name.as_str(), "Agent" | "Task"))
    })) {
        return Ok(Arc::clone(&parsed.messages));
    }
    let mut rows = parsed.messages.as_ref().clone();
    parsed.facts.apply_child(&mut rows, &parsed.agents);
    Ok(Arc::new(rows))
}

fn read_cached(path: String) -> Result<Arc<ChildEntry>, AdapterError> {
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    let _parse = PARSE_LOCKS[hash.finish() as usize % PARSE_LOCKS.len()].lock_recover();
    let stamp = Stamp::read(Path::new(&path))?;
    if let Some(entry) = cached(&path, &stamp) {
        return Ok(entry);
    }
    let entry = Arc::new(parse(path, stamp)?);
    if entry.stamp.0 <= 8 * 1024 * 1024
        && Stamp::read(Path::new(&entry.path)).is_ok_and(|after| after == entry.stamp)
    {
        let mut cache = CACHE.lock_recover();
        cache.push_front(Arc::clone(&entry));
        cache.truncate(8);
    }
    Ok(entry)
}

fn cached(path: &str, stamp: &Stamp) -> Option<Arc<ChildEntry>> {
    let mut cache = CACHE.lock_recover();
    if let Some(index) = cache.iter().position(|entry| entry.path == path)
        && let Some(entry) = cache.remove(index)
        && &entry.stamp == stamp
    {
        cache.push_front(Arc::clone(&entry));
        return Some(entry);
    }
    None
}

fn parse(path: String, stamp: Stamp) -> Result<ChildEntry, AdapterError> {
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_api = HashSet::new();
    let mut facts = history_agent_facts::AgentFacts::default();
    let mut agents = HashMap::new();
    visit_lines(&path, |line| {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            return;
        };
        facts.observe(&entry);
        capture_agent_id_mapping(&entry, &mut agents);
        if !is_strict_true(entry.get("isMeta"))
            && !is_strict_true(entry.get("isCompactSummary"))
            && matches!(entry["type"].as_str(), Some("assistant" | "user"))
            && let Some(message) = convert_history_entry(&entry, "", &mut seen_api)
            && seen.insert(message.id.clone())
        {
            rows.push(message);
        }
    })?;
    Ok(ChildEntry {
        path,
        stamp,
        messages: Arc::new(rows),
        facts,
        agents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[tokio::test]
    async fn saved_child_exposes_nested_call_facts_and_resolves_its_tool_id() {
        let root = tempfile::tempdir().unwrap();
        let children = root.path().join("session/subagents");
        std::fs::create_dir_all(&children).unwrap();
        std::fs::write(root.path().join("session.jsonl"), "{}").unwrap();
        std::fs::write(children.join("agent-outer.jsonl"), concat!(
            r#"{"type":"assistant","uuid":"outer-step","message":{"content":[{"type":"tool_use","id":"nested-call","name":"Agent","input":{}}]}}"#,
            "\n",
            r#"{"type":"user","uuid":"receipt","toolUseResult":{"agentId":"inner","status":"completed"},"message":{"content":[{"type":"tool_result","tool_use_id":"nested-call","content":"done"}]}}"#,
        )).unwrap();
        std::fs::write(children.join("agent-inner.jsonl"),
            r#"{"type":"assistant","uuid":"inner-step","message":{"content":[{"type":"text","text":"Nested answer"}]}}"#,
        ).unwrap();
        let discover =
            || discover_session_jsonl_files_in_dir("session", root.path().to_str().unwrap());
        std::fs::write(children.join("agent-unrelated.jsonl"), "{}").unwrap();
        reader::take_opened_paths();
        let outer = load(discover().await, "outer").unwrap();
        assert_eq!(
            outer[0].metadata.as_ref().unwrap()["subagentFacts"]["nested-call"]["status"],
            "completed"
        );
        let discovered = discover().await;
        let facts = &outer[0].metadata.as_ref().unwrap()["subagentFacts"]["nested-call"];
        let nested = load(discovered, facts["nativeAgentId"].as_str().unwrap()).unwrap();
        let opened = reader::take_opened_paths();
        assert_eq!(
            opened,
            ["agent-outer.jsonl", "agent-inner.jsonl"].map(|name| children
                .join(name)
                .to_str()
                .unwrap()
                .to_owned())
        );
        assert!(matches!(
            load(discover().await, ""),
            Err(AdapterError::Unavailable(_))
        ));
        assert!(matches!(
            load(discover().await, "nested-call"),
            Err(AdapterError::Unavailable(_))
        ));
        assert_eq!(
            reader::take_opened_paths(),
            [root.path().join("session.jsonl").to_str().unwrap()]
        );
        assert_eq!(nested[0].id, "inner-step");
    }

    #[test]
    fn child_cache_reuses_parsed_messages_and_invalidates_on_append() {
        fn line(id: &str) -> String {
            serde_json::json!({"type":"assistant","uuid":id,"message":
                {"id":id,"content":[{"type":"text","text":"Synthetic child message"}]}})
            .to_string()
        }
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "{}", line("one")).unwrap();
        let path = file.path().to_str().unwrap().to_owned();
        let first = read(path.clone()).unwrap();
        assert_eq!(first.len(), 1);
        assert!(Arc::ptr_eq(&first, &read(path.clone()).unwrap()));
        writeln!(file, "{}", line("two")).unwrap();
        let second = read(path).unwrap();
        assert_eq!(second.len(), 2);
        assert!(!Arc::ptr_eq(&first, &second));
    }
}
