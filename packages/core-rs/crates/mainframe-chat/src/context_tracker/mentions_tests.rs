use super::*;

#[test]
fn clean_reference_strips_tag_and_punctuation() {
    assert_eq!(clean_reference("src/foo.ts),"), "src/foo.ts");
    assert_eq!(
        clean_reference("src/foo.ts</command-message>"),
        "src/foo.ts"
    );
}

/// A `ContextDb` that records every mention it is asked to add.
#[derive(Default)]
struct RecordingDb {
    paths: std::sync::Mutex<Vec<String>>,
}
impl ContextDb for RecordingDb {
    fn add_mention(&self, _chat_id: &str, mention: &SessionMention) -> Result<bool, SeamError> {
        let mut paths = self.paths.lock().unwrap();
        paths.push(format!(
            "{}|{}",
            mention.path.clone().unwrap_or_default(),
            mention.name
        ));
        Ok(true)
    }
    fn get_mentions(&self, _chat_id: &str) -> Result<Vec<SessionMention>, SeamError> {
        Ok(Vec::new())
    }
    fn get_plan_files(&self, _chat_id: &str) -> Result<Vec<String>, SeamError> {
        Ok(Vec::new())
    }
    fn get_skill_files(&self, _chat_id: &str) -> Result<Vec<SkillFileEntry>, SeamError> {
        Ok(Vec::new())
    }
}

fn mentions_in(text: &str) -> Vec<String> {
    let db = RecordingDb::default();
    extract_mentions_from_text("c1", Some(text), &db).unwrap();
    db.paths.into_inner().unwrap()
}

#[test]
fn extract_mentions_reads_quoted_paths_with_spaces() {
    assert_eq!(
        mentions_in(r#"fix @"src/my file.ts" and @"Release Notes" then @src/main.rs,"#),
        vec![
            "src/my file.ts|my file.ts",
            "Release Notes|Release Notes",
            "src/main.rs|main.rs",
        ]
    );
}

#[test]
fn extract_mentions_skips_agent_and_unterminated_quotes() {
    assert_eq!(
        mentions_in("ask @\"reviewer (agent)\" about @\"src/a b.ts\nnext"),
        Vec::<String>::new()
    );
}
