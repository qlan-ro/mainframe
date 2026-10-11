use super::*;
use tempfile::tempdir;

const BLOCK_SCALAR_AGENT: &str = include_str!("../__fixtures__/agent-block-scalar.md");

#[tokio::test]
async fn create_and_list_agent_derives_description_from_heading() {
    let tmp = tempdir().unwrap();
    let input = CreateAgentInput {
        name: "planner".to_string(),
        description: "Plans work".to_string(),
        content: "Body text".to_string(),
        scope: AgentScope::Project,
    };
    let agent = create_agent(tmp.path().to_str().unwrap(), &input)
        .await
        .unwrap();
    assert_eq!(agent.id, "claude:project:agent:planner");
    assert_eq!(agent.content, "# planner\n\nBody text");

    let agents = list_agents(tmp.path().to_str().unwrap()).await;
    let planner = agents
        .iter()
        .find(|a| a.name == "planner")
        .expect("planner");
    // First non-blank line "# planner" → heading prefix stripped.
    assert_eq!(planner.description, "planner");
}

#[tokio::test]
async fn list_agents_carries_full_description_alongside_the_summary() {
    let tmp = tempdir().unwrap();
    let agents_dir = tmp.path().join(".claude").join("agents");
    fs::create_dir_all(&agents_dir).await.unwrap();
    fs::write(agents_dir.join("todo317-planner.md"), BLOCK_SCALAR_AGENT)
        .await
        .unwrap();

    let agents = list_agents(tmp.path().to_str().unwrap()).await;
    let planner = agents
        .iter()
        .find(|a| a.scope == AgentScope::Project && a.name == "todo317-planner")
        .expect("todo317-planner agent");

    assert_eq!(
        planner.description,
        "Use this agent to write a spec or an implementation plan from an approved brainstorm/design."
    );
    let full = planner
        .full_description
        .as_deref()
        .expect("full description");
    assert!(full.contains("<example>"));
    assert!(full.contains("Examples:"));
}
