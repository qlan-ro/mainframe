use super::*;

#[test]
fn reports_the_global_claude_md_as_an_absolute_claude_path() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join(".claude")).unwrap();
    std::fs::write(
        home.path().join(".claude").join("CLAUDE.md"),
        "global rules",
    )
    .unwrap();
    let proj = tempfile::tempdir().unwrap();

    let files = collect_claude_context_files(proj.path().to_str().unwrap(), Some(home.path()));

    assert_eq!(
        files.global,
        vec![ContextFile {
            path: home
                .path()
                .join(".claude")
                .join("CLAUDE.md")
                .to_string_lossy()
                .to_string(),
            content: "global rules".to_string(),
            source: ContextFileSource::Global,
        }]
    );
}

#[test]
fn reports_project_files_with_project_relative_paths() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("CLAUDE.md"), "root").unwrap();
    std::fs::create_dir_all(project.path().join(".claude")).unwrap();
    std::fs::write(project.path().join(".claude").join("AGENTS.md"), "nested").unwrap();
    let home = tempfile::tempdir().unwrap();

    let files = collect_claude_context_files(project.path().to_str().unwrap(), Some(home.path()));

    assert_eq!(
        files.project,
        vec![
            ContextFile {
                path: "CLAUDE.md".to_string(),
                content: "root".to_string(),
                source: ContextFileSource::Project,
            },
            ContextFile {
                path: Path::new(".claude")
                    .join("AGENTS.md")
                    .to_string_lossy()
                    .to_string(),
                content: "nested".to_string(),
                source: ContextFileSource::Project,
            },
        ]
    );
}

#[test]
fn omits_files_that_do_not_exist() {
    let proj = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let files = collect_claude_context_files(proj.path().to_str().unwrap(), Some(home.path()));
    assert!(files.global.is_empty());
    assert!(files.project.is_empty());
}
