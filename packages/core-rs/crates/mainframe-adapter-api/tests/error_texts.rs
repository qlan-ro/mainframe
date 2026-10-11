//! Golden texts for `AdapterError`. They reach the chat's error banner and
//! REST bodies verbatim, so each variant's text is wire contract.

use mainframe_adapter_api::AdapterError;
use mainframe_runtime::process::ExecError;

#[test]
fn adapter_error_texts_are_unchanged() {
    let cases: Vec<(AdapterError, &str)> = vec![
        (AdapterError::Message("rate limited".into()), "rate limited"),
        (
            AdapterError::NotSpawned("s1".into()),
            "Session s1 not spawned",
        ),
        (
            AdapterError::StdinFull("s1".into()),
            "Session s1 stdin queue is full",
        ),
        (
            AdapterError::NoActiveTurn("s1".into()),
            "Session s1 has no active turn to steer",
        ),
        (
            AdapterError::Unsupported("steer a running turn"),
            "this adapter cannot steer a running turn",
        ),
        (
            AdapterError::ProjectDirMissing("/p".into()),
            "Project directory does not exist or is not accessible: /p",
        ),
        (
            AdapterError::Spawn {
                what: "title binary",
                binary: "claude".into(),
                source: std::io::Error::other("ENOENT"),
            },
            "failed to spawn title binary claude: ENOENT",
        ),
        (
            AdapterError::Timeout("claude title generation timed out"),
            "claude title generation timed out",
        ),
        (
            AdapterError::Exited {
                what: "claude /usage pull",
                detail: "code 1: boom".into(),
            },
            "claude /usage pull exited with code 1: boom",
        ),
        (
            AdapterError::ControlFailed {
                subtype: "set_model".into(),
                reason: "timeout".into(),
            },
            "set_model failed: timeout",
        ),
        (
            AdapterError::Exec(ExecError::OutputLimit),
            "command output limit exceeded",
        ),
        (
            AdapterError::Invariant("no process info"),
            "no process info",
        ),
    ];
    for (error, text) in cases {
        assert_eq!(error.to_string(), text);
    }
}
