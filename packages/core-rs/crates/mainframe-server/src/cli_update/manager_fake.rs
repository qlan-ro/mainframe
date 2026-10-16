//! A scripted [`CliUpdateEnv`] for the manager tests.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_types::BoxFuture;
use mainframe_types::cli_update::{CliInstallMethod, ProviderCliStatus};
use mainframe_types::sync::LockExt as _;
use tokio::sync::Notify;

use super::CliUpdateManager;
use super::env::{CliUpdateEnv, Probe};
use super::install::{CommandSpec, Distribution, InstallPlan, LatestSource};
use super::run::{OutputSink, RunOutcome};

/// Scripted world: a CLI at `version`, a registry answering `latest`, and an
/// update that prints `lines`, ends with `outcome`, and (on success) bumps
/// the installed version to `version_after`.
pub(super) struct FakeEnv {
    pub(super) installed: Mutex<Option<String>>,
    pub(super) latest: Mutex<Option<String>>,
    pub(super) method: CliInstallMethod,
    pub(super) can_update: bool,
    pub(super) lines: Vec<&'static str>,
    pub(super) outcome: RunOutcome,
    pub(super) version_after: &'static str,
    /// When set, the update blocks until notified.
    pub(super) gate: Option<Arc<Notify>>,
    pub(super) now: AtomicI64,
    pub(super) emitted: Mutex<Vec<ProviderCliStatus>>,
    pub(super) latest_fetches: AtomicUsize,
    pub(super) reloads: AtomicUsize,
}

impl FakeEnv {
    pub(super) fn new() -> Self {
        Self {
            installed: Mutex::new(Some("0.155.1".into())),
            latest: Mutex::new(Some("0.163.0".into())),
            method: CliInstallMethod::Homebrew,
            can_update: true,
            lines: vec![
                "==> Upgrading codex",
                "🍺  codex was successfully upgraded!",
            ],
            outcome: RunOutcome::Exited(Some(0)),
            version_after: "0.163.0",
            gate: None,
            now: AtomicI64::new(1_000),
            emitted: Mutex::new(Vec::new()),
            latest_fetches: AtomicUsize::new(0),
            reloads: AtomicUsize::new(0),
        }
    }

    pub(super) fn last_emitted(&self) -> ProviderCliStatus {
        self.emitted.lock_recover().last().cloned().unwrap()
    }
}

impl CliUpdateEnv for FakeEnv {
    fn adapter_ids(&self) -> Vec<String> {
        vec!["codex".into(), "mock-cli".into()]
    }

    fn locate(&self, _adapter_id: String, _dist: Distribution) -> BoxFuture<'_, Option<Probe>> {
        let version = self.installed.lock_recover().clone();
        Box::pin(async move {
            Some(Probe {
                path: "/opt/homebrew/bin/codex".into(),
                version,
                plan: InstallPlan {
                    method: self.method,
                    latest: LatestSource::BrewCask {
                        token: "codex".into(),
                    },
                    command: CommandSpec {
                        program: "brew".into(),
                        args: vec!["upgrade".into(), "--cask".into(), "codex".into()],
                    },
                    can_update: self.can_update,
                },
            })
        })
    }

    fn fetch_latest(&self, _source: LatestSource) -> BoxFuture<'_, Option<String>> {
        self.latest_fetches.fetch_add(1, Ordering::SeqCst);
        let latest = self.latest.lock_recover().clone();
        Box::pin(async move { latest })
    }

    fn run_update(&self, _command: CommandSpec, sink: OutputSink) -> BoxFuture<'_, RunOutcome> {
        Box::pin(async move {
            for line in &self.lines {
                sink((*line).to_string());
            }
            if let Some(gate) = &self.gate {
                gate.notified().await;
            }
            if self.outcome == RunOutcome::Exited(Some(0)) {
                *self.installed.lock_recover() = Some(self.version_after.into());
            }
            self.outcome.clone()
        })
    }

    fn reload_adapter(&self, _adapter_id: String) -> BoxFuture<'_, ()> {
        self.reloads.fetch_add(1, Ordering::SeqCst);
        Box::pin(async {})
    }

    fn emit(&self, status: ProviderCliStatus) {
        self.emitted.lock_recover().push(status);
    }

    fn now_ms(&self) -> i64 {
        self.now.load(Ordering::SeqCst)
    }
}

pub(super) fn setup(env: FakeEnv) -> (Arc<CliUpdateManager>, Arc<FakeEnv>) {
    let env = Arc::new(env);
    (Arc::new(CliUpdateManager::new(env.clone())), env)
}

pub(super) async fn wait_for_finish(env: &FakeEnv) -> ProviderCliStatus {
    let finished = || {
        env.last_emitted()
            .update
            .is_some_and(|run| run.finished_at.is_some())
    };
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(2),
        Duration::from_millis(5),
        async || finished(),
    )
    .await
    .expect("update never finished");
    env.last_emitted()
}
