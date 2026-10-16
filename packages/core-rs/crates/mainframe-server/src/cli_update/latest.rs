//! Reading the latest published version for an install's channel. Parsing is
//! pure; [`fetch_latest`] does the network call and treats every failure as
//! "unknown" — an offline daemon must stay quiet.

use std::path::{Path, PathBuf};
use std::time::Duration;

use mainframe_adapter_api::version::CliVersion;
use serde_json::Value;

use super::install::LatestSource;

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const NPM_REGISTRY: &str = "https://registry.npmjs.org";
const BREW_API: &str = "https://formulae.brew.sh/api";
/// Claude Code's own update check reads `<base>/<channel>` as plain text.
const CLAUDE_RELEASES: &str = "https://downloads.claude.ai/claude-code-releases";

/// The URL to GET for `source`; `channel` only matters for Claude native.
pub fn source_url(source: &LatestSource, channel: &str) -> String {
    match source {
        LatestSource::Npm { package } => format!("{NPM_REGISTRY}/{package}/latest"),
        LatestSource::BrewCask { token } => format!("{BREW_API}/cask/{token}.json"),
        LatestSource::BrewFormula { name } => format!("{BREW_API}/formula/{name}.json"),
        LatestSource::ClaudeNative => format!("{CLAUDE_RELEASES}/{channel}"),
    }
}

/// The version in a response body from `source_url(source, _)`.
pub fn parse_latest(source: &LatestSource, body: &str) -> Option<String> {
    let raw = match source {
        LatestSource::ClaudeNative => body.trim().to_string(),
        LatestSource::Npm { .. } => json_str(body, &["version"])?,
        // Cask versions may carry a build suffix (`1.2.3,abc`).
        LatestSource::BrewCask { .. } => json_str(body, &["version"])?,
        LatestSource::BrewFormula { .. } => json_str(body, &["versions", "stable"])?,
    };
    CliVersion::parse(&raw).map(|version| version.to_string())
}

fn json_str(body: &str, path: &[&str]) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    path.iter()
        .try_fold(&value, |node, key| node.get(key))?
        .as_str()
        .map(str::to_string)
}

/// Claude Code's `autoUpdatesChannel` from its user settings: `stable` when
/// set so, `latest` otherwise (the CLI's own default).
pub fn claude_channel(settings_json: Option<&str>) -> &'static str {
    let channel = settings_json
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("autoUpdatesChannel")?
                .as_str()
                .map(str::to_string)
        });
    match channel.as_deref() {
        Some("stable") => "stable",
        _ => "latest",
    }
}

fn claude_settings_path() -> Option<PathBuf> {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => Some(Path::new(&dir).join("settings.json")),
        None => dirs::home_dir().map(|home| home.join(".claude").join("settings.json")),
    }
}

/// GET the latest version for `source`; `None` on any network, status or
/// parse failure (logged at debug, never surfaced as an error).
pub async fn fetch_latest(client: &reqwest::Client, source: &LatestSource) -> Option<String> {
    let channel = match source {
        LatestSource::ClaudeNative => {
            let settings = match claude_settings_path() {
                Some(path) => tokio::fs::read_to_string(path).await.ok(),
                None => None,
            };
            claude_channel(settings.as_deref())
        }
        _ => "latest",
    };
    let url = source_url(source, channel);
    let body = async {
        client
            .get(&url)
            .timeout(FETCH_TIMEOUT)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await
    }
    .await;
    match body {
        Ok(body) => parse_latest(source, &body),
        Err(error) => {
            tracing::debug!(%error, url, "latest CLI version check failed");
            None
        }
    }
}

#[cfg(test)]
#[path = "latest_tests.rs"]
mod tests;
