//! Provider CLI version/update status (`packages/types/src/cli-update.ts`).
//!
//! The daemon reports, per provider CLI it knows how to distribute, the
//! installed version, the latest version for that install's channel, and the
//! state of the last in-app update. Every change is pushed whole as
//! `provider.cli.updated`; clients replace their copy.

use serde::{Deserialize, Serialize};

/// How the resolved executable was installed, which decides the upgrade
/// command and where the latest version is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliInstallMethod {
    Homebrew,
    Npm,
    Pnpm,
    Bun,
    /// The CLI's own installer (Claude Code's `~/.local/share/claude`).
    Native,
    /// Not recognised: the client shows `update_command` to run by hand.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliUpdateState {
    Running,
    Succeeded,
    Failed,
}

/// The in-flight or most recent in-app update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdateRun {
    pub state: CliUpdateState,
    /// ANSI-stripped stdout+stderr tail, appended as the command runs.
    pub output: String,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    /// Why a failed run failed (spawn error, timeout, exit status).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The output looked like a permissions failure (root-owned prefix, sudo).
    pub permission_denied: bool,
    /// The version the CLI reports after a successful run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCliStatus {
    pub adapter_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub install_method: CliInstallMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    /// The command Update runs, or the one to run by hand when `can_update`
    /// is false. Display only; the daemon never runs this string.
    pub update_command: String,
    pub can_update: bool,
    /// Epoch ms of the last latest-version check, successful or not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<i64>,
    /// The last check could not reach the version source (offline, timeout).
    pub check_failed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<CliUpdateRun>,
}
