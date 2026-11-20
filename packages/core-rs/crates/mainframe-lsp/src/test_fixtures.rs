//! Managers whose servers are real children (`cat`, or a `/bin/sh` script)
//! with shrunk timers, so the suites run in real time.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use crate::manager::{CommandResolver, LspManager, ResolveFuture, Timeouts};
use crate::registry::{LspRegistry, ResolvedCommand};

pub(crate) struct FakeResolver {
    pub(crate) calls: AtomicUsize,
    command: ResolvedCommand,
}

impl CommandResolver for FakeResolver {
    fn resolve<'a>(&'a self, _language: &'a str, _project: &'a Path) -> ResolveFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Some(self.command.clone()) })
    }
}

/// Never reaps on its own and keeps the shutdown handshake short.
pub(crate) fn timeouts() -> Timeouts {
    Timeouts {
        idle: Duration::from_secs(60),
        shutdown_request: Duration::from_millis(50),
        shutdown_exit: Duration::from_millis(50),
        sigterm_grace: Duration::from_secs(1),
    }
}

pub(crate) fn manager_with(
    command: &str,
    args: &[&str],
    timeouts: Timeouts,
) -> (LspManager, Arc<FakeResolver>) {
    let resolver = Arc::new(FakeResolver {
        calls: AtomicUsize::new(0),
        command: ResolvedCommand {
            command: PathBuf::from(command),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        },
    });
    let manager =
        LspManager::with_resolver(Arc::new(LspRegistry::new()), resolver.clone(), timeouts);
    (manager, resolver)
}

/// Servers are `cat`: each framed message written to one comes back to the
/// attached session, and SIGTERM stops it.
pub(crate) fn echo_manager() -> LspManager {
    manager_with("cat", &[], timeouts()).0
}

/// Servers run `script` under `/bin/sh`.
pub(crate) fn script_manager(script: &str, timeouts: Timeouts) -> LspManager {
    manager_with("/bin/sh", &["-c", script], timeouts).0
}

pub(crate) async fn bounded<F: Future>(future: F) -> F::Output {
    tokio::time::timeout(Duration::from_secs(5), future)
        .await
        .expect("operation must finish")
}

pub(crate) async fn wait_for(what: &str, mut condition: impl FnMut() -> bool) {
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(5),
        Duration::from_millis(10),
        async || condition(),
    )
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

pub(crate) async fn assert_pid_gone(pid: u32) {
    wait_for("the server process to be gone", || {
        !mainframe_runtime::process::is_alive(pid)
    })
    .await;
}
