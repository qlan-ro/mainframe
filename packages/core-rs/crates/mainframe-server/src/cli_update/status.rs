//! Building a [`ProviderCliStatus`] from a probe and settling a finished
//! update run.

use mainframe_adapter_api::version::CliVersion;
use mainframe_types::cli_update::{CliUpdateRun, CliUpdateState, ProviderCliStatus};

use super::env::Probe;
use super::run::{RunOutcome, looks_like_permission_failure};

pub(super) fn is_running(status: &ProviderCliStatus) -> bool {
    status
        .update
        .as_ref()
        .is_some_and(|run| run.state == CliUpdateState::Running)
}

pub(super) fn build_status(
    adapter_id: &str,
    probe: &Probe,
    latest: Option<String>,
    previous: Option<&ProviderCliStatus>,
    now: i64,
) -> ProviderCliStatus {
    let check_failed = latest.is_none();
    let latest_version = latest.or_else(|| previous.and_then(|p| p.latest_version.clone()));
    let update_available = match (&probe.version, &latest_version) {
        (Some(installed), Some(latest)) => {
            match (CliVersion::parse(installed), CliVersion::parse(latest)) {
                (Some(installed), Some(latest)) => latest > installed,
                _ => false,
            }
        }
        _ => false,
    };
    ProviderCliStatus {
        adapter_id: adapter_id.to_string(),
        installed_version: probe.version.clone(),
        latest_version,
        update_available,
        install_method: probe.plan.method,
        executable_path: Some(probe.path.clone()),
        update_command: probe.plan.command.display(),
        can_update: probe.plan.can_update,
        checked_at: Some(now),
        check_failed,
        update: previous.and_then(|p| p.update.clone()),
    }
}

pub(super) fn complete_run(
    run: &mut CliUpdateRun,
    outcome: &RunOutcome,
    installed: Option<String>,
    now: i64,
) {
    run.finished_at = Some(now);
    let error = match outcome {
        RunOutcome::Exited(Some(0)) => None,
        RunOutcome::Exited(Some(code)) => {
            Some(format!("The update command exited with code {code}"))
        }
        RunOutcome::Exited(None) => Some("The update command was terminated".to_string()),
        RunOutcome::SpawnFailed(reason) => {
            Some(format!("The update command failed to start: {reason}"))
        }
        RunOutcome::TimedOut => Some("The update command timed out".to_string()),
    };
    match error {
        None => {
            run.state = CliUpdateState::Succeeded;
            run.version_after = installed;
        }
        Some(error) => {
            run.state = CliUpdateState::Failed;
            run.permission_denied =
                looks_like_permission_failure(&run.output) || looks_like_permission_failure(&error);
            run.error = Some(error);
        }
    }
}
