use super::*;

fn normalize(value: &mut serde_json::Value, project: &str) {
    match value {
        serde_json::Value::Object(map) => {
            for key in ["createdAt", "updatedAt", "timestamp"] {
                if map.contains_key(key) {
                    map.insert(key.into(), "TIME".into());
                }
            }
            for value in map.values_mut() {
                normalize(value, project);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                normalize(value, project);
            }
        }
        serde_json::Value::String(text) => {
            *text = text.replace(project, "PROJECT");
        }
        _ => {}
    }
}

fn project() -> tempfile::TempDir {
    let project = tempfile::tempdir().unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec![
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ],
    ] {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(project.path())
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    project
}

#[tokio::test]
async fn lifecycle_flows_match_recorded_base_sequences() {
    let project = project();
    let path = project.path().to_str().unwrap();
    let deps = FakeDeps::arc();
    deps.set_project_path(path);
    let manager = ChatManager::new(deps.clone());
    let chat = manager
        .create_chat(NewChat {
            project_id: "p1".into(),
            adapter_id: "claude".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    manager.rename_chat(&chat.id, "renamed");
    manager
        .enable_worktree(&chat.id, "main", "golden")
        .await
        .unwrap();
    manager.end_chat(&chat.id).await;
    manager.archive_chat(&chat.id, true).await;
    manager.dispose();
    let mut wire = serde_json::to_value(deps.events()).unwrap();
    normalize(&mut wire, path);
    // Creation enrichment is an intentional, separately pinned wire change.
    if let Some(chat) = wire[0].get_mut("chat").and_then(|c| c.as_object_mut()) {
        for key in [
            "displayStatus",
            "isRunning",
            "worktreeMissing",
            "directoryMissing",
            "backgroundActivity",
        ] {
            chat.remove(key);
        }
    }
    let actual = serde_json::to_string_pretty(&wire).unwrap();
    assert_eq!(actual, include_str!("flow_events.json").trim());
}
