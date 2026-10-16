//! Provider CLI version checks and in-app updates (#405).
//!
//! For every registered adapter with a known [`install::Distribution`], the
//! manager tracks the installed version, the latest version for that
//! install's channel, and the last in-app update. Every change reaches
//! clients whole as `provider.cli.updated`. Checks are quiet: a failed
//! version lookup keeps the last known latest version and only sets
//! `check_failed`. A successful update forces an adapter refresh so the new
//! binary's models appear without restarting the daemon; running sessions
//! keep the process they already spawned.

pub mod env;
pub mod install;
pub mod latest;
pub mod run;
mod status;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_types::cli_update::{CliUpdateRun, CliUpdateState, ProviderCliStatus};
use mainframe_types::sync::LockExt as _;

use env::CliUpdateEnv;
use install::{InstallPlan, distribution};
use run::{OutputSink, RunOutcome};
use status::{build_status, complete_run, is_running};

/// A non-forced check reuses a result younger than this.
const RECHECK_AFTER_MS: i64 = 60 * 60 * 1000;
/// Background cadence; the first pass waits for the boot catalog refresh.
const BOOT_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Output kept per run, in chars.
const OUTPUT_TAIL_CHARS: usize = 16_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CliUpdateError {
    #[error("Mainframe can't check or update this provider's CLI")]
    Unsupported,
    #[error("The provider CLI was not found")]
    NotInstalled,
    #[error("This install can't be updated from Mainframe; run the command shown")]
    NotUpdatable,
    #[error("An update is already running for this provider")]
    Busy,
}

struct Entry {
    status: ProviderCliStatus,
    plan: InstallPlan,
}

pub struct CliUpdateManager {
    env: Arc<dyn CliUpdateEnv>,
    entries: Mutex<HashMap<String, Entry>>,
}

impl CliUpdateManager {
    pub fn new(env: Arc<dyn CliUpdateEnv>) -> Self {
        Self {
            env,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// The last known status of every checked CLI.
    pub fn statuses(&self) -> Vec<ProviderCliStatus> {
        let mut out: Vec<_> = self
            .entries
            .lock_recover()
            .values()
            .map(|entry| entry.status.clone())
            .collect();
        out.sort_by(|a, b| a.adapter_id.cmp(&b.adapter_id));
        out
    }

    /// Re-check every supported adapter (results younger than an hour are
    /// reused unless `force`). Failures stay in each status.
    pub async fn check_all(&self, force: bool) {
        for id in self.env.adapter_ids() {
            if distribution(&id).is_some() {
                // A missing CLI simply has no status to report.
                /* expected */
                let _ = self.check(&id, force).await;
            }
        }
    }

    pub async fn check(
        &self,
        adapter_id: &str,
        force: bool,
    ) -> Result<ProviderCliStatus, CliUpdateError> {
        distribution(adapter_id).ok_or(CliUpdateError::Unsupported)?;
        if let Some(status) = self.reusable(adapter_id, force) {
            return Ok(status);
        }
        self.refresh(adapter_id).await
    }

    fn reusable(&self, adapter_id: &str, force: bool) -> Option<ProviderCliStatus> {
        let entries = self.entries.lock_recover();
        let status = &entries.get(adapter_id)?.status;
        let running = is_running(status);
        let fresh = status
            .checked_at
            .is_some_and(|at| self.env.now_ms() - at < RECHECK_AFTER_MS);
        (running || (fresh && !force)).then(|| status.clone())
    }

    /// Probe and look up the latest version, keeping the last update run.
    async fn refresh(&self, adapter_id: &str) -> Result<ProviderCliStatus, CliUpdateError> {
        let dist = distribution(adapter_id).ok_or(CliUpdateError::Unsupported)?;
        let Some(probe) = self.env.locate(adapter_id.to_string(), dist).await else {
            // A running update keeps its entry so its outcome still lands.
            let mut entries = self.entries.lock_recover();
            if entries
                .get(adapter_id)
                .is_some_and(|entry| !is_running(&entry.status))
            {
                entries.remove(adapter_id);
            }
            return Err(CliUpdateError::NotInstalled);
        };
        let latest = self.env.fetch_latest(probe.plan.latest.clone()).await;
        let status = {
            let mut entries = self.entries.lock_recover();
            let previous = entries.get(adapter_id).map(|entry| &entry.status);
            let status = build_status(adapter_id, &probe, latest, previous, self.env.now_ms());
            entries.insert(
                adapter_id.to_string(),
                Entry {
                    status: status.clone(),
                    plan: probe.plan,
                },
            );
            status
        };
        self.env.emit(status.clone());
        Ok(status)
    }

    /// Start the upgrade in the background; progress arrives as
    /// `provider.cli.updated`. Returns the status with the run started.
    pub fn start_update(
        self: &Arc<Self>,
        adapter_id: &str,
    ) -> Result<ProviderCliStatus, CliUpdateError> {
        distribution(adapter_id).ok_or(CliUpdateError::Unsupported)?;
        let (status, command) = {
            let mut entries = self.entries.lock_recover();
            let entry = entries
                .get_mut(adapter_id)
                .ok_or(CliUpdateError::NotInstalled)?;
            if is_running(&entry.status) {
                return Err(CliUpdateError::Busy);
            }
            if !entry.plan.can_update {
                return Err(CliUpdateError::NotUpdatable);
            }
            entry.status.update = Some(CliUpdateRun {
                state: CliUpdateState::Running,
                output: String::new(),
                started_at: self.env.now_ms(),
                finished_at: None,
                error: None,
                permission_denied: false,
                version_after: None,
            });
            (entry.status.clone(), entry.plan.command.clone())
        };
        self.env.emit(status.clone());
        let manager = self.clone();
        let id = adapter_id.to_string();
        tracing::info!(adapter_id, command = %command.display(), "provider CLI update started");
        tokio::spawn(async move { manager.finish_update(id, command).await });
        Ok(status)
    }

    async fn finish_update(self: Arc<Self>, adapter_id: String, command: install::CommandSpec) {
        let outcome = self
            .env
            .run_update(command, self.output_sink(&adapter_id))
            .await;
        let succeeded = outcome == RunOutcome::Exited(Some(0));
        if succeeded {
            self.env.reload_adapter(adapter_id.clone()).await;
        }
        // Re-probe first so `version_after` is the binary now on disk; a
        // vanished CLI keeps the entry and the run's own outcome.
        /* expected */
        let _ = self.refresh(&adapter_id).await;
        let status = {
            let mut entries = self.entries.lock_recover();
            let Some(entry) = entries.get_mut(&adapter_id) else {
                return;
            };
            let installed = entry.status.installed_version.clone();
            let now = self.env.now_ms();
            if let Some(run) = entry.status.update.as_mut() {
                complete_run(run, &outcome, installed, now);
            }
            entry.status.clone()
        };
        tracing::info!(adapter_id, outcome = ?outcome, "provider CLI update finished");
        self.env.emit(status);
    }

    /// Appends each output line to the running update and re-emits it.
    fn output_sink(self: &Arc<Self>, adapter_id: &str) -> OutputSink {
        let manager = Arc::downgrade(self);
        let id = adapter_id.to_string();
        Arc::new(move |line: String| {
            let Some(manager) = manager.upgrade() else {
                return;
            };
            let status = {
                let mut entries = manager.entries.lock_recover();
                let Some(entry) = entries.get_mut(&id) else {
                    return;
                };
                let Some(run) = entry.status.update.as_mut() else {
                    return;
                };
                run.output.push_str(&line);
                run.output.push('\n');
                run.output = crate::skills_cli::run::tail(&run.output, OUTPUT_TAIL_CHARS);
                entry.status.clone()
            };
            manager.env.emit(status);
        })
    }

    /// The background check loop; never returns.
    pub async fn run_periodic_checks(self: Arc<Self>) {
        tokio::time::sleep(BOOT_DELAY).await;
        loop {
            self.check_all(false).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    }
}

#[cfg(test)]
#[path = "manager_fake.rs"]
mod fake;
#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "manager_update_tests.rs"]
mod update_tests;
