use std::path::Path;
use std::sync::Arc;

use mainframe_runtime::process::{
    ManagedProcess, spawn_chunk_pump, spawn_line_pump, spawn_stdin_writer,
};
use mainframe_types::sync::LockExt as _;
use tokio::process::{Child, Command};

use super::handle::{LspServerHandle, Shared};
use super::{LspError, ManagerState, key};
use crate::framing::FrameParser;
use crate::registry::ResolvedCommand;

impl ManagerState {
    pub(super) async fn get_or_spawn(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let mut shutdown = self.shutting_down.subscribe();
        if *shutdown.borrow() {
            return Err(LspError::ShuttingDown);
        }
        tokio::select! {
            biased;
            _ = shutdown.changed() => Err(LspError::ShuttingDown),
            result = self.spawn_single_flight(project_id, language, project_path) => result,
        }
    }

    async fn spawn_single_flight(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let k = key(project_id, language);
        loop {
            let _claim = match self.flights.claim(&k) {
                Ok(claim) => claim,
                Err(waiter) => {
                    waiter.wait().await;
                    continue;
                }
            };
            let existing = self.handles.get(&k).map(|entry| entry.value().clone());
            let Some(existing) = existing else {
                return self.spawn(project_id, language, project_path).await;
            };
            {
                let mut inner = existing.lock();
                if !inner.closing {
                    // Restart the reaper: the caller has this long to attach.
                    self.arm_idle_timer(&existing, &mut inner);
                    return Ok(Arc::clone(&existing));
                }
            }
            // A shutdown owns the running server: let it finish, then spawn anew.
            self.await_shutdown(&existing).await;
        }
    }

    pub(super) async fn spawn(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let resolved = self
            .resolver
            .resolve(language, Path::new(project_path))
            .await
            .ok_or_else(|| LspError::NotInstalled(language.to_owned()))?;
        self.spawn_resolved(project_id, language, project_path, &resolved)
    }

    fn spawn_resolved(
        self: &Arc<Self>,
        project_id: &str,
        language: &str,
        project_path: &str,
        resolved: &ResolvedCommand,
    ) -> Result<Arc<LspServerHandle>, LspError> {
        let _gate = self.spawn_gate.lock_recover();
        if *self.shutting_down.borrow() {
            return Err(LspError::ShuttingDown);
        }
        tracing::info!(language, project_path, command = %resolved.command.display(), "spawning LSP server");
        let mut command = Command::new(&resolved.command);
        command
            .args(&resolved.args)
            .current_dir(project_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = self.registry.resolved_path() {
            path.apply(&mut command);
        }
        let mut child = command.spawn()?;
        let shared = Arc::new(Shared::default());
        let pid = child.id().unwrap_or_default();
        let stdin = spawn_stdin_writer(child.stdin.take());
        let pumps = output_pumps(&mut child, &shared, language);
        let handle = Arc::new(LspServerHandle {
            key: key(project_id, language),
            project_id: project_id.to_owned(),
            language: language.to_owned(),
            project_path: project_path.to_owned(),
            pid,
            process: ManagedProcess::spawn(child, pumps),
            stdin,
            shared,
        });
        self.handles.insert(handle.key.clone(), Arc::clone(&handle));
        self.arm_idle_timer(&handle, &mut handle.lock());
        self.watch_exit(&handle);
        Ok(handle)
    }

    /// Removes the handle once its child exits, closing its session. Holds
    /// the handle weakly: one nobody holds is killed by its `ManagedProcess`.
    fn watch_exit(self: &Arc<Self>, handle: &Arc<LspServerHandle>) {
        let state = Arc::clone(self);
        let exit = handle.process.exit();
        let weak = Arc::downgrade(handle);
        tokio::spawn(async move {
            let code = exit.wait().await;
            if let Some(handle) = weak.upgrade() {
                tracing::info!(
                    language = %handle.language, project_path = %handle.project_path,
                    pid = handle.pid, ?code, "LSP server exited"
                );
                state.remove_handle(&handle, 1001, "LSP server exited");
            }
        });
    }
}

/// The stdout pump deframes and routes the server's messages; the stderr
/// pump logs. Both run until the child closes its pipes.
fn output_pumps(
    child: &mut Child,
    shared: &Arc<Shared>,
    language: &str,
) -> Vec<tokio::task::JoinHandle<()>> {
    let mut pumps = Vec::with_capacity(2);
    if let Some(stdout) = child.stdout.take() {
        let shared = Arc::clone(shared);
        let mut parser = FrameParser::default();
        pumps.push(spawn_chunk_pump(stdout, move |chunk| {
            for message in parser.push(chunk) {
                shared.route(message);
            }
            true
        }));
    }
    if let Some(stderr) = child.stderr.take() {
        let language = language.to_owned();
        pumps.push(spawn_line_pump(stderr, move |line| {
            let line = line.trim();
            if !line.is_empty() {
                tracing::debug!(language = %language, stderr = %line, "LSP server stderr");
            }
        }));
    }
    pumps
}
