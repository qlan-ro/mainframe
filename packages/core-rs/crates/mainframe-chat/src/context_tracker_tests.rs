use super::*;
use mainframe_adapter_api::ContextFiles;
use mainframe_types::context::ContextFileSource;

fn ctx(path: &str, content: &str, source: ContextFileSource) -> ContextFile {
    ContextFile {
        path: path.to_string(),
        content: content.to_string(),
        source,
    }
}
fn skill(path: &str, display_name: &str) -> SkillFileEntry {
    SkillFileEntry {
        path: path.to_string(),
        display_name: display_name.to_string(),
    }
}

const PLUGIN: &str = "/home/me/.claude/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md";
const FALLBACK: &str = "/home/me/.claude/skills/tdd/SKILL.md";

/// A `ContextDb` returning fixed skill files and empty mentions/plan files.
struct CtxDb {
    skills: Vec<SkillFileEntry>,
}
impl ContextDb for CtxDb {
    fn add_mention(&self, _chat_id: &str, _mention: &SessionMention) -> Result<bool, SeamError> {
        Ok(false)
    }
    fn get_mentions(&self, _chat_id: &str) -> Result<Vec<SessionMention>, SeamError> {
        Ok(Vec::new())
    }
    fn get_plan_files(&self, _chat_id: &str) -> Result<Vec<String>, SeamError> {
        Ok(Vec::new())
    }
    fn get_skill_files(&self, _chat_id: &str) -> Result<Vec<SkillFileEntry>, SeamError> {
        Ok(self.skills.clone())
    }
}

/// A minimal `Adapter` double whose only meaningful method is
/// `get_context_files` (returns the fixture); everything else is inert.
struct CtxAdapter {
    context: mainframe_adapter_api::ContextFiles,
}
impl mainframe_adapter_api::Adapter for CtxAdapter {
    fn id(&self) -> &str {
        "claude"
    }
    fn name(&self) -> &str {
        "Claude"
    }
    fn capabilities(&self) -> mainframe_types::adapter::AdapterCapabilities {
        mainframe_types::adapter::AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        }
    }
    fn is_installed(
        &self,
    ) -> mainframe_adapter_api::BoxFuture<'_, Result<bool, mainframe_adapter_api::AdapterError>>
    {
        Box::pin(async { Ok(true) })
    }
    fn get_version(
        &self,
    ) -> mainframe_adapter_api::BoxFuture<
        '_,
        Result<Option<String>, mainframe_adapter_api::AdapterError>,
    > {
        Box::pin(async { Ok(None) })
    }
    fn catalog(&self) -> Vec<mainframe_types::adapter::AdapterModel> {
        Vec::new()
    }
    fn create_session(
        &self,
        _options: mainframe_types::adapter::SessionOptions,
    ) -> Arc<dyn AdapterSession> {
        Arc::new(crate::test_support::FakeSession::default())
    }
    fn kill_all(&self) {}
    fn get_context_files(
        &self,
        _project_path: &str,
    ) -> Option<mainframe_adapter_api::ContextFiles> {
        Some(self.context.clone())
    }
}

#[test]
fn dedupe_skill_files_drops_fallback_stub_when_real_path_exists() {
    let skills = vec![
        skill(PLUGIN, "tdd"),
        skill(FALLBACK, "tdd"),
        skill("/home/me/.claude/skills/verify/SKILL.md", "verify"),
    ];
    let exists = |p: &str| p == PLUGIN || p.ends_with("verify/SKILL.md");
    assert_eq!(
        dedupe_skill_files(skills, exists),
        vec![
            skill(PLUGIN, "tdd"),
            skill("/home/me/.claude/skills/verify/SKILL.md", "verify"),
        ]
    );
}

#[test]
fn dedupe_skill_files_keeps_real_path_even_when_fallback_listed_first() {
    let skills = vec![skill(FALLBACK, "tdd"), skill(PLUGIN, "tdd")];
    let exists = |p: &str| p == PLUGIN;
    assert_eq!(
        dedupe_skill_files(skills, exists),
        vec![skill(PLUGIN, "tdd")]
    );
}

#[test]
fn dedupe_skill_files_keeps_two_distinct_real_skills_sharing_a_leaf_name() {
    let personal = "/home/me/.claude/skills/tdd/SKILL.md";
    let skills = vec![skill(personal, "tdd"), skill(PLUGIN, "tdd")];
    assert_eq!(
        dedupe_skill_files(skills, |_p| true),
        vec![skill(personal, "tdd"), skill(PLUGIN, "tdd")]
    );
}

#[test]
fn dedupe_skill_files_surfaces_name_once_when_no_candidate_exists() {
    let skills = vec![skill(PLUGIN, "tdd"), skill(FALLBACK, "tdd")];
    assert_eq!(
        dedupe_skill_files(skills, |_p| false),
        vec![skill(PLUGIN, "tdd")]
    );
}

#[test]
fn dedupe_skill_files_removes_exact_path_repeats() {
    let skills = vec![skill(PLUGIN, "tdd"), skill(PLUGIN, "tdd")];
    assert_eq!(
        dedupe_skill_files(skills, |_p| true),
        vec![skill(PLUGIN, "tdd")]
    );
}

#[test]
fn dedupe_context_files_drops_project_file_pointing_at_a_global_one() {
    let home = "/home/me";
    let global = vec![ctx("~/.claude/CLAUDE.md", "g", ContextFileSource::Global)];
    let project = vec![ctx(".claude/CLAUDE.md", "g", ContextFileSource::Project)];

    let result = dedupe_context_files(global.clone(), project, home, home);

    assert_eq!(result.global, global);
    assert_eq!(result.project, Vec::<ContextFile>::new());
}

#[test]
fn dedupe_context_files_keeps_distinct_and_removes_within_list_repeats() {
    let home = "/home/me";
    let project = vec![
        ctx("CLAUDE.md", "a", ContextFileSource::Project),
        ctx("CLAUDE.md", "a", ContextFileSource::Project),
        ctx(".claude/AGENTS.md", "b", ContextFileSource::Project),
    ];

    let result = dedupe_context_files(Vec::new(), project, "/proj", home);

    assert_eq!(
        result.project,
        vec![
            ctx("CLAUDE.md", "a", ContextFileSource::Project),
            ctx(".claude/AGENTS.md", "b", ContextFileSource::Project),
        ]
    );
}

#[tokio::test]
async fn get_session_context_dedupes_skills_and_drops_project_dupes() {
    // Skill paths under a root that cannot exist, so the on-disk dedup is
    // deterministic (neither resolves → the first is kept).
    let skill_root = "/mf-nonexistent-test-root/.claude";
    let skills = vec![
        skill(
            &format!("{skill_root}/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md"),
            "tdd",
        ),
        skill(&format!("{skill_root}/skills/tdd/SKILL.md"), "tdd"),
    ];
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/home/me".to_string());
    let context = ContextFiles {
        global: vec![ctx("~/.claude/CLAUDE.md", "g", ContextFileSource::Global)],
        project: vec![ctx(".claude/CLAUDE.md", "g", ContextFileSource::Project)],
    };

    let db = CtxDb { skills };
    let adapters = AdapterRegistry::new();
    adapters.register(Arc::new(CtxAdapter { context }));

    let out = get_session_context(
        "chat-1",
        &home, // project opened at home → its .claude/CLAUDE.md is the global file
        &db,
        &adapters,
        None,
        None,
        Some("claude"),
    )
    .await
    .unwrap();

    assert_eq!(
        out.skill_files,
        vec![skill(
            &format!("{skill_root}/plugins/cache/mkt/sp/1.0/skills/tdd/SKILL.md"),
            "tdd"
        )]
    );
    assert_eq!(out.global_files.len(), 1);
    assert_eq!(out.project_files, Vec::<ContextFile>::new());
}

#[test]
fn saved_plan_path_wins() {
    let text = "Your plan has been saved to: /Users/x/proj/.plans/plan.md and more";
    assert_eq!(
        extract_plan_file_path_from_text(text),
        Some("/Users/x/proj/.plans/plan.md".to_string())
    );
}

#[test]
fn generic_backtick_wrapped_path() {
    let text = "see `/tmp/notes.md` now";
    assert_eq!(
        extract_plan_file_path_from_text(text),
        Some("/tmp/notes.md".to_string())
    );
}

#[test]
fn no_match_returns_none() {
    assert_eq!(extract_plan_file_path_from_text("nothing here"), None);
}

#[test]
fn relative_below_project() {
    assert_eq!(path_relative("/a/b", "/a/b/c/d.md"), "c/d.md");
    assert_eq!(path_relative("/a/b/c", "/a/x/y.md"), "../../x/y.md");
}
