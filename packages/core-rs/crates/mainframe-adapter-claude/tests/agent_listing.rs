//! RED-phase coverage for todo #317 (agent descriptions render as `---`).
//!
//! Drives `skills::list_agents`/`list_skills`/`create_agent`/`update_agent` against real
//! temp-directory fixtures. `list_agents` also scans the developer's real `~/.claude/agents`,
//! so every lookup filters on `todo317-` names and the `Project` scope, never by name alone.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_adapter_claude::frontmatter::parse_frontmatter;
use mainframe_adapter_claude::skills::{create_agent, list_agents, list_skills, update_agent};
use mainframe_types::skill::{AgentScope, CreateAgentInput, SkillScope};
use tempfile::tempdir;
use tokio::fs;

const BLOCK_SCALAR_AGENT: &str = include_str!("../src/__fixtures__/agent-block-scalar.md");

const FIRST_SENTENCE: &str =
    "Use this agent to write a spec or an implementation plan from an approved brainstorm/design.";

async fn write_agent(project_path: &std::path::Path, file_name: &str, content: &str) {
    let dir = project_path.join(".claude").join("agents");
    fs::create_dir_all(&dir).await.unwrap();
    fs::write(dir.join(file_name), content).await.unwrap();
}

#[tokio::test]
async fn block_scalar_description_becomes_first_sentence() {
    let tmp = tempdir().unwrap();
    write_agent(tmp.path(), "todo317-planner.md", BLOCK_SCALAR_AGENT).await;

    let agents = list_agents(tmp.path().to_str().unwrap()).await;
    let planner = agents
        .iter()
        .find(|a| a.scope == AgentScope::Project && a.name == "todo317-planner")
        .expect("todo317-planner agent");

    assert_eq!(planner.description, FIRST_SENTENCE);
    assert!(!planner.description.contains('\n'));
    assert!(!planner.description.contains("Examples:"));
    assert!(!planner.description.contains("<example>"));
}

#[tokio::test]
async fn attributes_after_a_block_scalar_survive() {
    let fm = parse_frontmatter(BLOCK_SCALAR_AGENT);
    assert_eq!(
        fm.attributes.get("tools").map(String::as_str),
        Some("Read, Grep")
    );
}

#[tokio::test]
async fn no_frontmatter_agent_uses_heading_heuristic() {
    let tmp = tempdir().unwrap();
    write_agent(
        tmp.path(),
        "todo317-legacy.md",
        "# todo317-legacy\n\nBody text describing the legacy agent.",
    )
    .await;

    let agents = list_agents(tmp.path().to_str().unwrap()).await;
    let legacy = agents
        .iter()
        .find(|a| a.scope == AgentScope::Project && a.name == "todo317-legacy")
        .expect("todo317-legacy agent");

    assert_eq!(legacy.description, "todo317-legacy");
}

#[tokio::test]
async fn empty_frontmatter_description_falls_back_to_heuristic() {
    let tmp = tempdir().unwrap();
    write_agent(
        tmp.path(),
        "todo317-empty.md",
        "---\nname: todo317-empty\ndescription:\n---\n\n# todo317-empty\n\nBody text.",
    )
    .await;

    let agents = list_agents(tmp.path().to_str().unwrap()).await;
    let empty = agents
        .iter()
        .find(|a| a.scope == AgentScope::Project && a.name == "todo317-empty")
        .expect("todo317-empty agent");

    assert_eq!(empty.description, "todo317-empty");
}

#[tokio::test]
async fn inline_frontmatter_description_used_verbatim() {
    let tmp = tempdir().unwrap();
    write_agent(
        tmp.path(),
        "todo317-reviewer.md",
        "---\nname: todo317-reviewer\ndescription: Reviews auth changes.\n---\n\n# todo317-reviewer\n\nBody.",
    )
    .await;

    let agents = list_agents(tmp.path().to_str().unwrap()).await;
    let reviewer = agents
        .iter()
        .find(|a| a.scope == AgentScope::Project && a.name == "todo317-reviewer")
        .expect("todo317-reviewer agent");

    assert_eq!(reviewer.description, "Reviews auth changes.");
}

#[tokio::test]
async fn update_agent_rederives_description() {
    let tmp = tempdir().unwrap();
    let input = CreateAgentInput {
        name: "todo317-updated".to_string(),
        description: "placeholder".to_string(),
        content: "Body text".to_string(),
        scope: AgentScope::Project,
    };
    let created = create_agent(tmp.path().to_str().unwrap(), &input)
        .await
        .unwrap();

    let updated = update_agent(
        &created.id,
        tmp.path().to_str().unwrap(),
        BLOCK_SCALAR_AGENT,
    )
    .await
    .unwrap();

    assert_eq!(updated.description, FIRST_SENTENCE);
}

#[tokio::test]
async fn skill_with_block_scalar_description_is_not_empty() {
    let tmp = tempdir().unwrap();
    let skill_dir = tmp
        .path()
        .join(".claude")
        .join("skills")
        .join("todo317-skill");
    fs::create_dir_all(&skill_dir).await.unwrap();
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: todo317-skill\ndescription: |\n  Handles PDF review requests end to end.\ntools: Read\n---\n\n# todo317-skill",
    )
    .await
    .unwrap();

    let skills = list_skills(tmp.path().to_str().unwrap()).await;
    let skill = skills
        .iter()
        .find(|s| s.scope == SkillScope::Project && s.name == "todo317-skill")
        .expect("todo317-skill");

    assert_eq!(skill.description, "Handles PDF review requests end to end.");
}
