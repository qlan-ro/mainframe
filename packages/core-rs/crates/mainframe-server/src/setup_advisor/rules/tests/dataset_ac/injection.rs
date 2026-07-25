//! AC 6 (mandatory): the injected fingerprint must still recommend something
//! real, and the payload must never reach a `command`.

use mainframe_types::setup_advisor::ProjectFingerprint;

use super::super::super::all;
use crate::setup_advisor::recommend::recommend;

const INJECTION: &str = "; rm -rf ~";

/// A fingerprint carrying the literal injection payload in `frameworks`/
/// `externalApis` must still recommend something real — `mcp-context7` fires
/// on any non-empty `frameworks`, regardless of its content — and the payload
/// must never reach a `command`.
#[test]
fn a_malicious_dependency_name_never_reaches_a_command() {
    let fp = ProjectFingerprint {
        frameworks: vec![INJECTION.to_string()],
        external_apis: vec![INJECTION.to_string()],
        ..Default::default()
    };
    let recs = recommend(&fp);

    assert!(
        !recs.is_empty(),
        "injection fixture produced no recommendations — this assertion would pass vacuously"
    );

    for r in &recs {
        assert!(
            !r.command.contains("rm -rf"),
            "rule `{}` leaked the injected command: {:?}",
            r.id,
            r.command
        );
        assert!(!r.id.contains(INJECTION), "{}", r.id);
        assert!(!r.title.contains(INJECTION), "{}", r.id);
        assert!(!r.command.contains(INJECTION), "{}", r.id);
        if let Some(path) = &r.target_path {
            assert!(!path.contains(INJECTION), "{}: {path}", r.id);
        }
    }
}

/// Second half of AC 6: evaluate the full dataset against both a benign and a
/// malicious fingerprint and confirm every fired rule's `command` is byte-
/// identical to the dataset's own constant — the sanitizer must never touch
/// `command`, only `signal`.
#[test]
fn every_fired_commands_bytes_match_its_declared_constant_benign_and_malicious() {
    let benign = ProjectFingerprint {
        databases: vec!["postgres".to_string()],
        tooling: vec!["prettier".to_string()],
        has_claude_config: true,
        ..Default::default()
    };
    let malicious = ProjectFingerprint {
        databases: vec!["postgres".to_string(), INJECTION.to_string()],
        tooling: vec!["prettier".to_string(), INJECTION.to_string()],
        frameworks: vec![INJECTION.to_string()],
        external_apis: vec![INJECTION.to_string()],
        has_claude_config: true,
        ..Default::default()
    };

    let dataset = all();
    for fp in [&benign, &malicious] {
        for r in recommend(fp) {
            let rule = dataset
                .iter()
                .find(|rule| rule.id == r.id)
                .unwrap_or_else(|| panic!("recommendation `{}` has no matching rule", r.id));
            assert_eq!(
                rule.command, r.command,
                "rule `{}` command diverged from its declared constant",
                r.id
            );
        }
    }
}
