use super::*;

pub(crate) async fn load_discovered_history(
    session_id: &str,
    discovered: &DiscoveredFiles,
    base: &str,
    messages: bool,
) -> Result<
    (
        Vec<ChatMessage>,
        mainframe_adapter_api::CollectedHistoryFiles,
    ),
    mainframe_adapter_api::AdapterError,
> {
    load_with_reader(session_id, discovered, base, messages, reader::open_reader).await
}

async fn load_with_reader<R: std::io::BufRead>(
    session_id: &str,
    discovered: &DiscoveredFiles,
    base: &str,
    messages: bool,
    open: impl Fn(&str) -> std::io::Result<R> + Send + 'static,
) -> Result<
    (
        Vec<ChatMessage>,
        mainframe_adapter_api::CollectedHistoryFiles,
    ),
    mainframe_adapter_api::AdapterError,
> {
    if discovered.all_files.is_empty() {
        return Ok(Default::default());
    }
    let mut paths = PathCollector::default();
    let mut load = HistoryLoad::default();
    let primary = discovered.primary_path.clone();
    let children = discovered.subagent_files.clone();
    let (session_id, base) = (session_id.to_owned(), base.to_owned());
    if messages && discovered.complete {
        paths.files.sources = source_stamps(std::slice::from_ref(&primary)).await;
    }
    run_history_worker(move || {
        let mut facts = history_agent_facts::AgentFacts::default();
        let result = open(&primary).and_then(|reader| {
            reader::read_chunks(reader, |line| {
                let Ok(entry) = serde_json::from_slice(line.as_bytes()) else {
                    paths.observe_plan(line, &base);
                    return;
                };
                paths.observe(&entry, line, &base);
                if messages {
                    facts.observe(&entry);
                    load.entry(&entry, &session_id, false);
                }
            })
        });
        if result.is_err() {
            paths.files.sources = None;
        }
        let agent_ids = std::mem::take(&mut load.agent_id_to_parent_tool_use_id);
        let mut rows = load.finish();
        facts.apply(&mut rows, &agent_ids, &children);
        (rows, paths.files)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_adapter_api::Adapter;
    use mainframe_types::adapter::SessionOptions;
    use std::io::{self, BufRead, BufReader, Read};

    struct ReadFailure;

    impl Read for ReadFailure {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("injected read failure"))
        }
    }

    fn message(id: &str) -> String {
        serde_json::json!({
            "type": "assistant", "uuid": id, "sessionId": "session",
            "timestamp": "2026-09-25T00:00:00Z",
            "message": {"content": [{"type": "text", "text": id}]}
        })
        .to_string()
    }

    #[tokio::test]
    async fn failed_open_rescans_primary() {
        check_recovery(false).await;
    }

    #[tokio::test]
    async fn failed_read_keeps_complete_records_and_rescans() {
        check_recovery(true).await;
    }

    async fn check_recovery(mid_read: bool) {
        let dir = tempfile::tempdir().unwrap();
        let primary = dir.path().join("session.jsonl");
        let sibling = dir.path().join("healthy.jsonl");
        let prefix = format!("{}\n", message("first"));
        let plan = r#"{"type":"user","toolUseResult":{"plan":"done","filePath":"/recovered.md"}}"#;
        std::fs::write(&primary, format!("{prefix}{plan}")).unwrap();
        std::fs::write(&sibling, message("healthy")).unwrap();
        let path = primary.to_str().unwrap().to_owned();
        let base = dir.path().to_str().unwrap();
        let files = DiscoveredFiles {
            primary_path: path.clone(),
            all_files: vec![path.clone(), sibling.to_str().unwrap().into()],
            subagent_files: [sibling.to_str().unwrap().to_owned()].into_iter().collect(),
            complete: true,
        };
        let failed = path.clone();
        let open = move |file: &str| -> io::Result<Box<dyn BufRead>> {
            assert_eq!(file, failed, "cold restore opened a child transcript");
            if mid_read {
                return Ok(Box::new(BufReader::new(
                    io::Cursor::new(prefix.clone().into_bytes()).chain(ReadFailure),
                )));
            }
            Err(io::Error::other("injected open failure"))
        };
        let (rows, carried) = load_with_reader("session", &files, base, true, open)
            .await
            .unwrap();
        assert_eq!(rows.len(), usize::from(mid_read));
        assert!(carried.sources.is_none());
        assert!(carried.plans.is_empty());
        let session = crate::adapter::ClaudeAdapter::default().create_session(SessionOptions {
            project_path: base.into(),
            chat_id: Some("session".into()),
            session_file_path: Some(path),
            mainframe_chat_id: "chat".into(),
            fork_source: None,
        });
        assert_eq!(
            session
                .scan_history_files(Some(carried))
                .await
                .unwrap()
                .plans,
            ["/recovered.md"]
        );
    }
}
