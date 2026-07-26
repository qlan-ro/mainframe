//! What detection refuses to pull into memory.

use super::fingerprint_of;

/// A manifest is a small file. Reading whatever a repo happens to have named
/// `package.json` into a `String` first and judging it afterwards is how a
/// checked-in fixture or a generated blob turns one HTTP request into a
/// multi-hundred-megabyte allocation.
#[tokio::test]
async fn a_manifest_past_the_size_cap_contributes_nothing() {
    let padding = " ".repeat(3 * 1024 * 1024);
    let oversized = format!(r#"{{{padding}"dependencies": {{ "react": "18.2.0" }} }}"#);

    let fp = fingerprint_of(&[("package.json", &oversized)]).await;

    assert!(fp.frameworks.is_empty(), "frameworks: {:?}", fp.frameworks);
}

#[tokio::test]
async fn a_manifest_under_the_size_cap_is_read_normally() {
    let padding = " ".repeat(1024);
    let ordinary = format!(r#"{{{padding}"dependencies": {{ "react": "18.2.0" }} }}"#);

    let fp = fingerprint_of(&[("package.json", &ordinary)]).await;

    assert!(fp.frameworks.contains(&"react".to_string()));
}

/// The language manifests are never parsed — only their presence is the signal —
/// so the size cap that protects the parsed manifests must not silently un-detect
/// a language because the repo has a large generated `Cargo.toml`.
#[tokio::test]
async fn a_language_is_claimed_from_a_manifest_of_any_size() {
    let huge = " ".repeat(3 * 1024 * 1024);

    let fp = fingerprint_of(&[("Cargo.toml", &huge)]).await;

    assert!(fp.languages.contains(&"rust".to_string()));
}
