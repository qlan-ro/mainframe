use super::*;

fn npm() -> LatestSource {
    LatestSource::Npm {
        package: "@openai/codex".into(),
    }
}

#[test]
fn urls_per_source() {
    assert_eq!(
        source_url(&npm(), "latest"),
        "https://registry.npmjs.org/@openai/codex/latest"
    );
    assert_eq!(
        source_url(
            &LatestSource::BrewCask {
                token: "codex".into()
            },
            "latest"
        ),
        "https://formulae.brew.sh/api/cask/codex.json"
    );
    assert_eq!(
        source_url(
            &LatestSource::BrewFormula {
                name: "codex".into()
            },
            "latest"
        ),
        "https://formulae.brew.sh/api/formula/codex.json"
    );
    assert_eq!(
        source_url(&LatestSource::ClaudeNative, "stable"),
        "https://downloads.claude.ai/claude-code-releases/stable"
    );
}

#[test]
fn parses_each_source_body() {
    assert_eq!(
        parse_latest(&npm(), r#"{"name":"@openai/codex","version":"0.163.0"}"#).as_deref(),
        Some("0.163.0")
    );
    assert_eq!(
        parse_latest(
            &LatestSource::BrewCask {
                token: "codex".into()
            },
            r#"{"token":"codex","version":"0.162.0,abc123"}"#
        )
        .as_deref(),
        Some("0.162.0")
    );
    assert_eq!(
        parse_latest(
            &LatestSource::BrewFormula {
                name: "codex".into()
            },
            r#"{"versions":{"stable":"0.161.2","head":"HEAD"}}"#
        )
        .as_deref(),
        Some("0.161.2")
    );
    assert_eq!(
        parse_latest(&LatestSource::ClaudeNative, "2.1.301\n").as_deref(),
        Some("2.1.301")
    );
}

#[test]
fn unparseable_bodies_are_unknown() {
    assert_eq!(parse_latest(&npm(), "<html>rate limited</html>"), None);
    assert_eq!(parse_latest(&npm(), r#"{"version":"next"}"#), None);
    assert_eq!(parse_latest(&LatestSource::ClaudeNative, "Not Found"), None);
}

#[test]
fn claude_channel_defaults_to_latest() {
    assert_eq!(claude_channel(None), "latest");
    assert_eq!(claude_channel(Some("{}")), "latest");
    assert_eq!(claude_channel(Some("not json")), "latest");
    assert_eq!(
        claude_channel(Some(r#"{"autoUpdatesChannel":"stable"}"#)),
        "stable"
    );
    assert_eq!(
        claude_channel(Some(r#"{"autoUpdatesChannel":"../etc"}"#)),
        "latest"
    );
}
