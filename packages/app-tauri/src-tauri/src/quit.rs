use std::sync::atomic::{AtomicU8, Ordering};

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
    Ready,
}

enum Request {
    Start,
    Defer,
    Allow,
}

struct Shutdown(AtomicU8);

impl Shutdown {
    const fn new() -> Self {
        Self(AtomicU8::new(Phase::Running as u8))
    }

    fn request(&self) -> Request {
        match self.0.compare_exchange(
            Phase::Running as u8,
            Phase::Stopping as u8,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => Request::Start,
            Err(phase) if phase == Phase::Ready as u8 => Request::Allow,
            Err(_) => Request::Defer,
        }
    }

    fn finish(&self, stop: impl FnOnce()) {
        stop();
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
            match SHUTDOWN.request() {
                Request::Start => {
                    api.prevent_exit();
                    start(app, Exit::Quit(code.unwrap_or(0)));
                }
                Request::Defer => api.prevent_exit(),
                Request::Allow => {}
            }
        }
        RunEvent::Exit => {
            // An exit that bypasses ExitRequested cannot wait for graceful shutdown here.
            if let Some(daemon) = DAEMON.get() {
                daemon.kill_now();
            }
            if let Some(manager) = app.try_state::<TerminalManager>() {
                manager.kill_all();
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
    if matches!(SHUTDOWN.request(), Request::Start) {
        start(app, Exit::Restart);
    }
}

fn start(app: &AppHandle, exit: Exit) {
    for window in app.webview_windows().into_values() {
        if let Err(error) = window.hide() {
            tracing::warn!(%error, "could not hide window on quit");
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        SHUTDOWN.finish(stop_daemon);
        match exit {
            Exit::Quit(code) => app.exit(code),
            Exit::Restart => app.request_restart(),
            #[cfg(target_os = "macos")]
            Exit::Native => macos::complete_quit(&app),
        }
    });
}

fn stop_daemon() {
    if let Err(error) = presence::post_state_sync(daemon_port(), presence::Presence::Idle) {
        tracing::warn!(%error, "quit-path idle presence report failed");
    }
    if let Some(daemon) = DAEMON.get() {
        daemon.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_quit_waits_for_the_same_child_then_allows_exit() {
        let shutdown = Shutdown::new();
        let mut fake_child_running = true;
        assert!(matches!(shutdown.request(), Request::Start));
        assert!(matches!(shutdown.request(), Request::Defer));

        shutdown.finish(|| {
            assert!(fake_child_running);
            assert!(matches!(shutdown.request(), Request::Defer));
            fake_child_running = false;
        });
        assert!(!fake_child_running);
        assert!(matches!(shutdown.request(), Request::Allow));
    }
}
