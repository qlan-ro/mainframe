#[tokio::test]
async fn the_guard_is_released_when_the_operation_finishes_and_when_it_fails() {
    let (_dir, path) = fake_skills_binary();
    let succeeding_project = "guard-project-success";
    let failing_project = "guard-project-failure";

    let success_runner = RecordingRunner::queued(vec![success_outcome()]);
    mainframe_server::skills_cli::install(
        &success_runner,
        &path,
        mainframe_server::skills_cli::InstallRequest {
            project_id: succeeding_project,
            project_path: PROJECT_PATH,
            source: "owner/repo",
            skills: &owned(&["a"]),
            scope: Scope::Project,
            adapter_id: Some("claude"),
        },
    )
    .await
    .expect("install succeeds");
    assert!(
        mainframe_server::skills_cli::locks::acquire(succeeding_project).is_some(),
        "the guard must be released after a successful operation"
    );

    let failing_runner = RecordingRunner::queued(vec![CliOutcome {
        started: true,
        timed_out: false,
        exit_code: Some(1),
        stdout: String::new(),
        stderr: "error: boom".to_string(),
    }]);
    let failed = mainframe_server::skills_cli::install(
        &failing_runner,
        &path,
        mainframe_server::skills_cli::InstallRequest {
            project_id: failing_project,
            project_path: PROJECT_PATH,
            source: "owner/repo",
            skills: &owned(&["a"]),
            scope: Scope::Project,
            adapter_id: Some("claude"),
        },
    )
    .await;
    assert!(
        matches!(failed, Err(SkillsCliError::Cli { .. })),
        "expected the queued nonzero exit to surface as a Cli error, got {failed:?}"
    );
    assert!(
        mainframe_server::skills_cli::locks::acquire(failing_project).is_some(),
        "the guard must be released after a failed operation too"
    );
}
