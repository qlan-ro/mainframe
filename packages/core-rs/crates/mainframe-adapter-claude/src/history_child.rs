use super::*;
use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

use mainframe_adapter_api::AdapterError;
use mainframe_types::sync::LockExt as _;

type Messages = Arc<Vec<ChatMessage>>;
static CACHE: LazyLock<Mutex<VecDeque<ChildEntry>>> = LazyLock::new(Default::default);

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

pub(crate) fn load(discovered: DiscoveredFiles, id: &str) -> Result<Messages, AdapterError> {
    let mut agents = HashMap::new();
    if !discovered
        .subagent_files
        .iter()
        .any(|file| agent_id(file) == Some(id))
    {
        visit_lines(&discovered.primary_path, |line| {
            if line.contains("\"agentId\"")
                && let Ok(entry) = serde_json::from_str(line)
            {
                capture_agent_id_mapping(&entry, &mut agents);
            }
        })?;
    }
    let path = discovered
        .subagent_files
        .into_iter()
        .find(|file| {
            agent_id(file).is_some_and(|agent| {
                agent == id || agents.get(agent).is_some_and(|tool| tool == id)
            })
        })
        .ok_or(AdapterError::Unavailable(
            "Sub-agent transcript is unavailable",
        ))?;
    read(path)
}

fn agent_id(file: &str) -> Option<&str> {
    Path::new(file)
        .file_stem()?
        .to_str()?
        .strip_prefix("agent-")
}

fn read(path: String) -> Result<Messages, AdapterError> {
    let stamp = Stamp::read(Path::new(&path))?;
    {
        let mut cache = CACHE.lock_recover();
        if let Some(index) = cache.iter().position(|entry| entry.path == path)
            && let Some(entry) = cache.remove(index)
            && entry.stamp == stamp
        {
            let messages = Arc::clone(&entry.messages);
            cache.push_front(entry);
            return Ok(messages);
        }
    }
    let messages = parse(&path)?;
    if stamp.0 <= 8 * 1024 * 1024 && Stamp::read(Path::new(&path)).is_ok_and(|after| after == stamp)
    {
        let mut cache = CACHE.lock_recover();
        cache.retain(|entry| entry.path != path);
        cache.push_front(ChildEntry {
            path,
            stamp,
            messages: Arc::clone(&messages),
        });
        cache.truncate(8);
    }
    Ok(messages)
}

fn parse(path: &str) -> Result<Messages, AdapterError> {
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_api = HashSet::new();
    visit_lines(path, |line| {
        if let Ok(entry) = serde_json::from_str::<Value>(line)
            && !is_strict_true(entry.get("isMeta"))
            && !is_strict_true(entry.get("isCompactSummary"))
            && matches!(entry["type"].as_str(), Some("assistant" | "user"))
            && let Some(message) = convert_history_entry(&entry, "", &mut seen_api)
            && seen.insert(message.id.clone())
        {
            rows.push(message);
        }
    })?;
    Ok(Arc::new(rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
