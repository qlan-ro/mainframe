mod reader;

use std::collections::HashMap;
use std::io::Write;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{ipc::{Channel, InvokeResponseBody}, State};

/// Sent on the typed exit channel when the child process ends.
#[derive(Serialize, Clone)]
pub struct ExitEvent {
    pub code: Option<i32>,
}

struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Owns every live PTY. Registered in Tauri-managed state.
///
/// The reader thread never touches `sessions` (C3). When its cloned reader hits
/// EOF it reports the id on `reap_tx`; the manager drains `reap_rx` on every
/// lock-taking method and removes any self-reported-dead sessions. This makes
/// lifecycle deterministic regardless of insert-vs-EOF timing.
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
    shell_env: HashMap<String, String>,
    reap_tx: Sender<String>,
    reap_rx: Mutex<Receiver<String>>,
}

/// Validate that `cwd` is an existing directory.
pub fn validate_cwd(cwd: &str) -> Result<(), String> {
    let meta = std::fs::metadata(cwd).map_err(|e| format!("invalid cwd {cwd}: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {cwd}"));
    }
    Ok(())
}

fn resolve_shell(env: &HashMap<String, String>) -> String {
    if cfg!(windows) {
        return "powershell.exe".to_string();
    }
    env.get("SHELL").cloned().unwrap_or_else(|| "/bin/zsh".to_string())
}

impl TerminalManager {
    pub fn new(shell_env: HashMap<String, String>) -> Self {
        let (reap_tx, reap_rx) = channel();
        Self {
            sessions: Mutex::new(HashMap::new()),
            shell_env,
            reap_tx,
            reap_rx: Mutex::new(reap_rx),
        }
    }

    /// Lock the session map, recovering a poisoned guard instead of panicking —
    /// release builds run `panic = "abort"`, so a poison panic would kill the app.
    fn lock_sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, Session>> {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Remove any sessions whose reader thread has reported EOF (self-reaped).
    /// Called by every lock-taking method so a self-exited child never lingers.
    fn drain_reaped(&self) {
        let rx = self.reap_rx.lock().unwrap_or_else(|e| e.into_inner());
        let dead: Vec<String> = rx.try_iter().collect();
        if dead.is_empty() {
            return;
        }
        drop(rx); // release the reap_rx lock before taking sessions lock
        let mut sessions = self.lock_sessions();
        for id in dead {
            sessions.remove(&id);
        }
    }

    pub fn count(&self) -> usize {
        self.drain_reaped();
        self.lock_sessions().len()
    }

    /// Spawn a shell, register the session, then start the reader thread.
    /// `on_data` is called with each chunk of PTY output; `on_exit` once on EOF.
    ///
    /// Order matters (C3): the session is inserted into the map BEFORE the reader
    /// thread starts, and the reader thread NEVER locks the map.
    pub fn spawn<D, E>(
        &self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        on_data: D,
        on_exit: E,
    ) -> Result<(), String>
    where
        D: Fn(Vec<u8>) + Send + 'static,
        E: Fn(Option<i32>) + Send + 'static,
    {
        self.drain_reaped();
        validate_cwd(cwd)?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let shell = resolve_shell(&self.shell_env);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);
        for (k, v) in &self.shell_env {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("TERM_PROGRAM", "Mainframe");
        cmd.env("ZSH_DOTENV_PROMPT", "false");

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn failed: {e}"))?;
        let cloned_reader = pair.master.try_clone_reader().map_err(|e| format!("reader clone failed: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("take_writer failed: {e}"))?;

        // Insert FIRST so a fast EOF can never race ahead of registration (C3).
        self.lock_sessions().insert(
            id.to_string(),
            Session { master: pair.master, writer, child },
        );

        let id_owned = id.to_string();
        let reap_tx = self.reap_tx.clone();
        std::thread::spawn(move || {
            reader::run_reader_loop(cloned_reader, id_owned, reap_tx, on_data, on_exit);
        });

        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        self.drain_reaped();
        let mut guard = self.lock_sessions();
        let s = guard.get_mut(id).ok_or_else(|| format!("no terminal {id}"))?;
        s.writer.write_all(data.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
        s.writer.flush().map_err(|e| format!("flush failed: {e}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self.lock_sessions();
        let s = guard.get(id).ok_or_else(|| format!("no terminal {id}"))?;
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize failed: {e}"))
    }

    /// Kill a terminal. `child.kill()` runs FIRST (closes the slave fd → the
    /// cloned reader hits EOF → the reader thread ends + fires on_exit), THEN we
    /// remove the session. The reader's EOF is the load-bearing mechanism (C2).
    pub fn kill(&self, id: &str) {
        let mut guard = self.lock_sessions();
        if let Some(mut s) = guard.remove(id) {
            let _ = s.child.kill();
        }
        // The reader thread pushes `id` onto reap_tx after EOF; draining later
        // is a harmless no-op since the entry is already gone.
    }

    pub fn kill_all(&self) {
        let mut guard = self.lock_sessions();
        for (_, s) in guard.iter_mut() {
            let _ = s.child.kill(); // kill first → readers EOF → on_exit fires
        }
        guard.clear();
    }
}

#[tauri::command]
pub fn terminal_create(
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel,
    on_exit: Channel<ExitEvent>,
    manager: State<'_, TerminalManager>,
) -> Result<(), String> {
    let data_ch = on_data.clone();
    let exit_ch = on_exit.clone();
    manager.spawn(
        &id,
        &cwd,
        cols,
        rows,
        move |bytes| {
            // Reader thread: never panic across the FFI boundary (panic="abort").
            if let Err(e) = data_ch.send(InvokeResponseBody::Raw(bytes)) {
                tracing::warn!(%e, "terminal on_data channel send failed");
            }
        },
        move |code| {
            if let Err(e) = exit_ch.send(ExitEvent { code }) {
                tracing::warn!(%e, "terminal on_exit channel send failed");
            }
        },
    )
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: String,
    manager: State<'_, TerminalManager>,
) -> Result<(), String> {
    manager.write(&id, &data)
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    manager: State<'_, TerminalManager>,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

#[tauri::command]
pub fn terminal_kill(id: String, manager: State<'_, TerminalManager>) {
    manager.kill(&id);
}

#[cfg(test)]
mod tests;
