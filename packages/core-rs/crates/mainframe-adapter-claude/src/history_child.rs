use super::*;
use std::collections::VecDeque;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, LazyLock, Mutex};

use mainframe_adapter_api::AdapterError;
use mainframe_types::sync::LockExt as _;

#[path = "history_child_cache.rs"]
mod cache;
use cache::{ChildEntry, Messages, Stamp};

static PARSE_LOCKS: [Mutex<()>; 16] = [const { Mutex::new(()) }; 16];
static CALLS: LazyLock<Mutex<VecDeque<Arc<CallMemo>>>> = LazyLock::new(Default::default);
const CALL_MEMOS: usize = 8;

/// Which agent each Agent call of a parent transcript started, keyed by the
/// parent files' stamps, so a tool-call id resolves with one scan of the parent
/// instead of one per page, lazy image and expand.
struct CallMemo {
    stamps: Vec<(String, Option<Stamp>)>,
    /// Native agent id to the tool call that started it.
    agents: HashMap<String, String>,
}

pub(crate) fn load(discovered: DiscoveredFiles, id: &str) -> Result<Messages, AdapterError> {
    let path = resolve(&discovered, id)?;
    read(path)
}

/// `id` is the native agent id the parent's facts carry, which names the file
/// directly. A tool-call id (from a history cached before the facts carried the
/// agent id) still resolves through the parent's agent mapping, scanned once per
/// version of the parent files.
fn resolve(discovered: &DiscoveredFiles, id: &str) -> Result<String, AdapterError> {
    let children = &discovered.subagent_files;
    if id.is_empty() {
        return Err(unavailable());
    }
    if let Some(path) = children.iter().find(|file| agent_id(file) == Some(id)) {
        return Ok(path.clone());
    }
    let memo = parent_agents(discovered);
    // An agent the parent names whose file is gone: no call id can match it.
    if memo.agents.contains_key(id) {
        return Err(unavailable());
    }
    memo.agents
        .iter()
        .filter(|(_, call)| call.as_str() == id)
        .find_map(|(agent, _)| children.iter().find(|file| agent_id(file) == Some(agent)))
        .cloned()
        .ok_or_else(unavailable)
}

fn parent_agents(discovered: &DiscoveredFiles) -> Arc<CallMemo> {
    let stamps: Vec<_> = discovered
        .parent_files()
        .map(|path| (path.clone(), Stamp::read(Path::new(path)).ok()))
        .collect();
    let mut memos = CALLS.lock_recover();
    if let Some(index) = memos.iter().position(|memo| memo.stamps == stamps)
        && let Some(memo) = memos.remove(index)
    {
        memos.push_front(Arc::clone(&memo));
        return memo;
    }
    drop(memos);
    let mut agents = HashMap::new();
    for (source, _) in &stamps {
        // An unreadable parent file names no agents; the others still resolve.
        /* expected */
        let _ = visit_lines(source, |line| {
            if line.contains("\"agentId\"")
                && let Ok(entry) = serde_json::from_str(line)
            {
                capture_agent_id_mapping(&entry, &mut agents);
            }
        });
    }
    let memo = Arc::new(CallMemo { stamps, agents });
    let mut memos = CALLS.lock_recover();
    memos.retain(|other| other.stamps.first() != memo.stamps.first());
    memos.push_front(Arc::clone(&memo));
    memos.truncate(CALL_MEMOS);
    memo
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
    if let Some(messages) = cache::cached(&path, &stamp) {
        return Ok(messages);
    }
    let entry = Arc::new(parse(path, stamp)?);
    let messages = Arc::clone(&entry.messages);
    if Stamp::read(Path::new(&entry.path)).is_ok_and(|after| after == entry.stamp) {
        cache::keep(entry);
    }
    Ok(messages)
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

    #[tokio::test]
    async fn a_tool_call_id_scans_the_parent_once_per_version() {
        let root = tempfile::tempdir().unwrap();
        let children = root.path().join("session/subagents");
        std::fs::create_dir_all(&children).unwrap();
        let parent = root.path().join("session.jsonl");
        let receipt = |call: &str, agent: &str| {
            serde_json::json!({"type":"user","uuid":format!("receipt-{call}"),
                "toolUseResult":{"agentId":agent,"status":"completed"},
                "message":{"content":[{"type":"tool_result","tool_use_id":call,"content":"done"}]}})
            .to_string()
        };
        std::fs::write(
            &parent,
            format!(
                "{}\n{}\n",
                receipt("call-a", "worker"),
                receipt("call-b", "gone")
            ),
        )
        .unwrap();
        std::fs::write(children.join("agent-worker.jsonl"),
            r#"{"type":"assistant","uuid":"worker-step","message":{"content":[{"type":"text","text":"Child answer"}]}}"#,
        ).unwrap();
        let discover =
            || discover_session_jsonl_files_in_dir("session", root.path().to_str().unwrap());
        let parent_path = parent.to_str().unwrap().to_owned();
        reader::take_opened_paths();
        assert_eq!(
            load(discover().await, "call-a").unwrap()[0].id,
            "worker-step"
        );
        assert!(reader::take_opened_paths().contains(&parent_path));
        // Later images and expands: the memo answers, the child comes from the cache.
        load(discover().await, "call-a").unwrap();
        // An agent the parent names but whose file is gone, and its call: no scan.
        for id in ["gone", "call-b"] {
            assert!(matches!(
                load(discover().await, id),
                Err(AdapterError::Unavailable(_))
            ));
        }
        assert!(reader::take_opened_paths().is_empty());
        // The parent grew: its mapping is read again, once.
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&parent)
            .unwrap();
        writeln!(file, "{}", receipt("call-c", "other")).unwrap();
        load(discover().await, "call-a").unwrap();
        load(discover().await, "call-a").unwrap();
        assert_eq!(reader::take_opened_paths(), [parent_path]);
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
