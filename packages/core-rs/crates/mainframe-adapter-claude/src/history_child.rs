use super::*;
use std::collections::VecDeque;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

use mainframe_adapter_api::AdapterError;
use mainframe_types::sync::LockExt as _;

type Messages = Arc<Vec<ChatMessage>>;
static PARSE_LOCKS: [Mutex<()>; 16] = [const { Mutex::new(()) }; 16];
/// Parsed children kept by the size of their files, so the largest child of a
/// long session stays cached across pages instead of being parsed again.
const CACHE_BUDGET_BYTES: u64 = 64 * 1024 * 1024;
static CACHE: LazyLock<Mutex<ChildCache>> =
    LazyLock::new(|| Mutex::new(ChildCache::new(CACHE_BUDGET_BYTES)));

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
}

/// Most recently used first; evicts from the back once the files' bytes pass
/// the budget. A child larger than the whole budget is never kept.
struct ChildCache {
    entries: VecDeque<Arc<ChildEntry>>,
    bytes: u64,
    budget: u64,
}

impl ChildCache {
    const fn new(budget: u64) -> Self {
        Self {
            entries: VecDeque::new(),
            bytes: 0,
            budget,
        }
    }

    fn take(&mut self, path: &str) -> Option<Arc<ChildEntry>> {
        let index = self.entries.iter().position(|entry| entry.path == path)?;
        let entry = self.entries.remove(index)?;
        self.bytes -= entry.stamp.0;
        Some(entry)
    }

    fn get(&mut self, path: &str, stamp: &Stamp) -> Option<Arc<ChildEntry>> {
        let entry = self.take(path).filter(|entry| &entry.stamp == stamp)?;
        self.insert(Arc::clone(&entry));
        Some(entry)
    }

    fn insert(&mut self, entry: Arc<ChildEntry>) {
        self.take(&entry.path);
        if entry.stamp.0 > self.budget {
            return;
        }
        self.bytes += entry.stamp.0;
        self.entries.push_front(entry);
        while self.bytes > self.budget
            && let Some(evicted) = self.entries.pop_back()
        {
            self.bytes -= evicted.stamp.0;
        }
    }
}

pub(crate) fn load(discovered: DiscoveredFiles, id: &str) -> Result<Messages, AdapterError> {
    let path = resolve(&discovered, id)?;
    read(path)
}

/// `id` is the native agent id the parent's facts carry, which names the file
/// directly. A tool-call id (from a history cached before the facts carried the
/// agent id) still resolves by scanning the parent for its agent mapping.
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
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    let _parse = PARSE_LOCKS[hash.finish() as usize % PARSE_LOCKS.len()].lock_recover();
    let stamp = Stamp::read(Path::new(&path))?;
    if let Some(entry) = CACHE.lock_recover().get(&path, &stamp) {
        return Ok(Arc::clone(&entry.messages));
    }
    let entry = Arc::new(parse(path, stamp)?);
    if Stamp::read(Path::new(&entry.path)).is_ok_and(|after| after == entry.stamp) {
        CACHE.lock_recover().insert(Arc::clone(&entry));
    }
    Ok(Arc::clone(&entry.messages))
}

/// Reads the child once and attaches its own nested calls' facts, so a cached
/// entry is served as-is on every later page.
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
    facts.apply_child(&mut rows, &agents);
    Ok(ChildEntry {
        path,
        stamp,
        messages: Arc::new(rows),
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

    #[tokio::test]
    async fn page_after_a_parent_read_opens_only_the_child_file() {
        let root = tempfile::tempdir().unwrap();
        let children = root.path().join("session/subagents");
        std::fs::create_dir_all(&children).unwrap();
        std::fs::write(root.path().join("session.jsonl"), concat!(
            r#"{"type":"assistant","uuid":"call-step","message":{"content":[{"type":"tool_use","id":"agent-call","name":"Agent","input":{}}]}}"#,
            "\n",
            r#"{"type":"user","uuid":"receipt","toolUseResult":{"agentId":"worker","status":"completed"},"message":{"content":[{"type":"tool_result","tool_use_id":"agent-call","content":"done"}]}}"#,
        )).unwrap();
        let child = children.join("agent-worker.jsonl");
        std::fs::write(&child,
            r#"{"type":"assistant","uuid":"worker-step","message":{"content":[{"type":"text","text":"Child answer"}]}}"#,
        ).unwrap();
        let base = root.path().to_str().unwrap();
        let discovered = discover_session_jsonl_files_in_dir("session", base).await;
        let (parent, _) = load_discovered_history("session", &discovered, base, true)
            .await
            .unwrap();
        let facts = &parent[0].metadata.as_ref().unwrap()["subagentFacts"]["agent-call"];
        assert_eq!(facts["nativeAgentId"], "worker");
        reader::take_opened_paths();
        let rows = load(discovered, facts["nativeAgentId"].as_str().unwrap()).unwrap();
        assert_eq!(rows[0].id, "worker-step");
        assert_eq!(
            reader::take_opened_paths(),
            [child.to_str().unwrap().to_owned()]
        );
    }

    fn entry(path: &str, bytes: u64) -> Arc<ChildEntry> {
        Arc::new(ChildEntry {
            path: path.into(),
            stamp: Stamp(bytes, SystemTime::UNIX_EPOCH),
            messages: Arc::default(),
        })
    }

    fn paths(cache: &ChildCache) -> Vec<&str> {
        cache
            .entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect()
    }

    #[test]
    fn child_cache_keeps_children_within_its_byte_budget() {
        let mut cache = ChildCache::new(30);
        cache.insert(entry("a", 25));
        cache.insert(entry("b", 4));
        assert_eq!(paths(&cache), ["b", "a"]);
        assert!(cache.get("a", &Stamp(25, SystemTime::UNIX_EPOCH)).is_some());
        cache.insert(entry("c", 3));
        assert_eq!(paths(&cache), ["c", "a"]);
        assert_eq!(cache.bytes, 28);
        cache.insert(entry("huge", 31));
        assert_eq!(paths(&cache), ["c", "a"]);
        assert!(cache.get("a", &Stamp(26, SystemTime::UNIX_EPOCH)).is_none());
        assert_eq!(paths(&cache), ["c"]);
        assert_eq!(cache.bytes, 3);
    }

    #[test]
    fn child_cache_holds_a_child_larger_than_the_old_eight_mebibyte_cap() {
        let mut cache = ChildCache::new(CACHE_BUDGET_BYTES);
        cache.insert(entry("largest", 25 * 1024 * 1024));
        cache.insert(entry("next", 12 * 1024 * 1024));
        let stamp = Stamp(25 * 1024 * 1024, SystemTime::UNIX_EPOCH);
        assert!(cache.get("largest", &stamp).is_some());
        assert_eq!(paths(&cache), ["largest", "next"]);
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
