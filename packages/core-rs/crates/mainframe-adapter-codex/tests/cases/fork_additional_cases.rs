#[test]
fn capabilities_fork_is_gated_on_the_observed_cli_version() {
    let adapter = CodexAdapter::default();
    assert!(!adapter.capabilities().fork, "no version observed yet");
    assert_eq!(adapter.fork_unavailable_reason(), None);

    adapter.observe_cli_version(Some("0.142.9"));
    assert!(!adapter.capabilities().fork);
    assert_eq!(
        adapter.fork_unavailable_reason(),
        Some(
            "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.142.9)".to_string()
        )
    );

    adapter.observe_cli_version(Some("0.143.0"));
    assert!(adapter.capabilities().fork);
    assert_eq!(adapter.fork_unavailable_reason(), None);
}
