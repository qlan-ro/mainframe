#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod model_support;

use mainframe_adapter_api::Adapter;
use mainframe_adapter_codex::CodexAdapter;
use model_support::Fixture;

#[tokio::test]
async fn a_rejected_model_probe_handshake_closes_the_child_process() {
    let fixture = Fixture::new();
    let project = std::path::PathBuf::from(fixture.project());
    std::fs::write(project.join("handshake-error"), "").unwrap();
    assert_eq!(
        CodexAdapter::default()
            .configured_model(fixture.project(), Some(fixture.executable()),)
            .await,
        None
    );
    let pid = std::fs::read_to_string(project.join("probe.pid")).unwrap();
    for _ in 0..20 {
        if !is_alive(&pid).await {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let _ = tokio::process::Command::new("/bin/kill")
        .arg(&pid)
        .output()
        .await;
    panic!("model probe left its rejected child alive");
}

async fn is_alive(pid: &str) -> bool {
    tokio::process::Command::new("/bin/kill")
        .args(["-0", pid])
        .output()
        .await
        .unwrap()
        .status
        .success()
}
