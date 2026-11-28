use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};

use crate::{daemon_port, presence, PreviewManager, TerminalManager, DAEMON};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::install_native_quit;

#[repr(u8)]
#[derive(Clone, Copy)]
enum Phase {
    Running,
    Stopping,
    NativeStopping,
    Ready,
}

enum Request {
    Start,
    Defer,
    DeferNative,
    Allow,
}

struct Shutdown(AtomicU8);

impl Shutdown {
    const fn new() -> Self {
        Self(AtomicU8::new(Phase::Running as u8))
    }

    fn request(&self, native: bool) -> Request {
        let next = if native {
            Phase::NativeStopping
        } else {
            Phase::Stopping
        };
        match self.0.compare_exchange(
            Phase::Running as u8,
            next as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => Request::Start,
            Err(phase) if phase == Phase::NativeStopping as u8 => Request::DeferNative,
            Err(phase) if phase == Phase::Ready as u8 => Request::Allow,
            Err(_) => Request::Defer,
        }
    }

    fn finish(&self) {
        self.0.store(Phase::Ready as u8, Ordering::Release);
    }
}

static SHUTDOWN: Shutdown = Shutdown::new();

#[derive(Clone, Copy)]
enum Exit {
    Quit(i32),
    Restart,
    #[cfg(target_os = "macos")]
    Native,
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { code, api, .. } if code != Some(tauri::RESTART_EXIT_CODE) => {
            match SHUTDOWN.request(false) {
                Request::Start => {
                    api.prevent_exit();
                    start(app, Exit::Quit(code.unwrap_or(0)));
                }
                Request::Defer | Request::DeferNative => api.prevent_exit(),
                Request::Allow => {}
            }
        }
        RunEvent::Exit => {
            // An exit that bypasses ExitRequested cannot wait for graceful shutdown here.
            DAEMON.close();
            if let Some(daemon) = DAEMON.get() {
                daemon.kill_now();
            }
            if let Some(manager) = app.try_state::<PreviewManager>() {
                manager.kill_all();
            }
        }
        _ => {}
    }
}

pub fn restart(app: &AppHandle) {
    // Tauri's restart exit cannot be prevented, so drain before requesting it.
    if matches!(SHUTDOWN.request(false), Request::Start) {
        start(app, Exit::Restart);
    }
}

fn start(app: &AppHandle, exit: Exit) {
    for window in app.webview_windows().into_values() {
        if let Err(error) = window.hide() {
            tracing::warn!(%error, "could not hide window on quit");
        }
    }
    let supervisor_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("quit-supervisor".into())
        .spawn(move || {
            let worker_app = supervisor_app.clone();
            let result = supervise(Duration::from_secs(13), move || {
                stop_daemon();
                if let Some(manager) = worker_app.try_state::<TerminalManager>() {
                    manager.kill_all();
                }
            });
            if !matches!(result, Ok(Ok(()))) {
                tracing::warn!(?result, "quit cleanup did not complete");
                emergency_stop();
            }
            finish(&supervisor_app, exit);
        })
    {
        tracing::warn!(%error, "could not start quit supervisor");
        emergency_stop();
        finish(app, exit);
    }
}

fn supervise(
    deadline: Duration,
    cleanup: impl FnOnce() + Send + 'static,
) -> std::io::Result<Result<(), RecvTimeoutError>> {
    let (done, finished) = mpsc::channel();
    std::thread::Builder::new()
        .name("quit-cleanup".into())
        .spawn(move || {
            cleanup();
            let _ = done.send(());
        })?;
    Ok(finished.recv_timeout(deadline))
}

fn emergency_stop() {
    DAEMON.close();
    if let Some(daemon) = DAEMON.get() {
        daemon.kill_now();
    }
}

fn finish(app: &AppHandle, exit: Exit) {
    SHUTDOWN.finish();
    match exit {
        Exit::Quit(code) => app.exit(code),
        Exit::Restart => app.request_restart(),
        #[cfg(target_os = "macos")]
        Exit::Native => macos::complete_quit(app),
    }
}

fn stop_daemon() {
    if let Err(error) = presence::post_state_sync(daemon_port(), presence::Presence::Idle) {
        tracing::warn!(%error, "quit-path idle presence report failed");
    }
    // A launch still waiting for the login-shell env must not spawn after this.
    DAEMON.close();
    if let Some(daemon) = DAEMON.get() {
        daemon.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_native_quit_shares_the_first_reply() {
        let shutdown = Shutdown::new();
        assert!(matches!(shutdown.request(true), Request::Start));
        assert!(matches!(shutdown.request(true), Request::DeferNative));
        assert!(matches!(shutdown.request(false), Request::DeferNative));
        shutdown.finish();
        assert!(matches!(shutdown.request(true), Request::Allow));
    }

    #[test]
    fn native_quit_does_not_replace_an_in_progress_restart() {
        let shutdown = Shutdown::new();
        assert!(matches!(shutdown.request(false), Request::Start));
        assert!(matches!(shutdown.request(true), Request::Defer));
        shutdown.finish();
        assert!(matches!(shutdown.request(false), Request::Allow));
    }

    #[test]
    fn supervisor_observes_worker_panic_instead_of_waiting_forever() {
        assert_eq!(
            supervise(Duration::from_secs(5), || panic!("test cleanup panic")).unwrap(),
            Err(RecvTimeoutError::Disconnected),
        );
    }

    #[test]
    fn supervisor_deadline_does_not_wait_for_a_stalled_worker() {
        let (release, blocked) = std::sync::mpsc::channel();
        let (returned, wait_for_worker) = std::sync::mpsc::channel();
        let result = supervise(Duration::from_millis(20), move || {
            blocked.recv().unwrap();
            returned.send(()).unwrap();
        });
        assert_eq!(result.unwrap(), Err(RecvTimeoutError::Timeout));
        release.send(()).unwrap();
        wait_for_worker
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
    }
}
