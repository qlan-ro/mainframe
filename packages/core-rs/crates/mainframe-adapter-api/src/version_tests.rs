use super::CliVersion;

#[test]
fn extracts_and_displays_first_triple_without_rewriting_digits() {
    assert_eq!(
        CliVersion::parse("claude 02.1.198 (build 7)")
            .unwrap()
            .to_string(),
        "02.1.198"
    );
    assert_eq!(CliVersion::parse("no version"), None);
}

#[test]
fn compares_numeric_components_even_when_they_overflow_u64() {
    let newer = CliVersion::parse("184467440737095516160.0.0").unwrap();
    assert!(newer > CliVersion::parse("9.999.999").unwrap());
    assert!(
        CliVersion::parse("1.0.109-beta")
            .unwrap()
            .at_least(1, 0, 109)
    );
    assert!(!CliVersion::parse("1.0.108").unwrap().at_least(1, 0, 109));
}

fn daemon_path() -> mainframe_runtime::ResolvedPath {
    mainframe_runtime::ResolvedPath::from_value(std::env::var("PATH").unwrap_or_default())
}

#[tokio::test]
async fn a_missing_binary_has_no_version() {
    let missing = "/nonexistent/mainframe-no-such-cli";

    assert_eq!(super::version_stdout(missing, &daemon_path()).await, None);
}

#[tokio::test]
async fn a_hanging_binary_is_killed_at_the_probe_timeout() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let cli = dir.path().join("hanging-cli");
    std::fs::write(
        &cli,
        format!(
            "#!/bin/sh\necho $$ > '{}'\nexec sleep 60\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();

    let started = std::time::Instant::now();
    let version = super::version_stdout(cli.to_str().unwrap(), &daemon_path()).await;
    let elapsed = started.elapsed();

    assert_eq!(version, None);
    assert!(
        elapsed >= super::VERSION_PROBE_TIMEOUT
            && elapsed < super::VERSION_PROBE_TIMEOUT + std::time::Duration::from_secs(3),
        "returned after {elapsed:?}"
    );
    let pid: u32 = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert!(
        !mainframe_runtime::process::is_alive(pid),
        "the probe must kill and reap the hanging CLI"
    );
}
