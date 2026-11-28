//! Login-shell environment at launch, without blocking the window.
//!
//! [`EnvBoot::start`] reads the cached env and starts capturing a fresh one on a
//! background thread, then returns at once, so the window is created while the
//! shell is still starting. The daemon takes its env from
//! [`EnvBoot::daemon_env`]:
//!
//! - **Cached env** (valid cache): returned immediately. The daemon never waits
//!   for the shell. A capture that has already finished wins over the cache.
//! - **No usable cache** (first launch, or a shell start-up file changed): waits
//!   up to [`DAEMON_ENV_WAIT`] for the capture, then falls back to
//!   [`build_fallback_env`].
//!
//! A cached or fresh capture is handed to the sidecar flagged as resolved
//! (`MAINFRAME_SHELL_ENV_RESOLVED=1`, see `sidecar.rs`), so the daemon uses its
//! PATH and skips its own login-shell probe. With the fallback env the flag is
//! removed and the daemon probes for itself.
//!
//! Every successful capture rewrites the cache and replaces the env new
//! terminals use. A running daemon keeps the env it started with: when a
//! capture differs from it (or arrives after the daemon took the fallback), the
//! new env applies on the next daemon start, which is the next app launch. The
//! sidecar is not restarted mid-session because a restart would drop the
//! renderer's connection and any running agent sessions while boot restore is
//! in flight; the difference and the changed key names are logged instead.

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime};

use crate::shell_env::{self, build_fallback_env, cache, Env};

/// How long the daemon waits for a capture when there is no usable cache.
pub const DAEMON_ENV_WAIT: Duration = Duration::from_secs(5);

/// The env new terminals spawn with. Starts as the cached (or fallback) env
/// and is replaced when a fresh capture lands.
#[derive(Clone)]
pub struct SharedEnv(Arc<RwLock<Env>>);

impl SharedEnv {
    pub fn snapshot(&self) -> Env {
        self.0.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn replace(&self, env: Env) {
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = env;
    }
}

impl From<Env> for SharedEnv {
    fn from(env: Env) -> Self {
        Self(Arc::new(RwLock::new(env)))
    }
}

/// Where the daemon's env came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnvSource {
    Cached,
    LoginShell,
    Fallback,
}

impl EnvSource {
    pub fn as_str(self) -> &'static str {
        match self {
            EnvSource::Cached => "cached",
            EnvSource::LoginShell => "login_shell",
            EnvSource::Fallback => "fallback",
        }
    }
}

pub struct EnvBootConfig {
    pub shell: String,
    /// `None` disables the cache.
    pub cache_path: Option<PathBuf>,
    pub home: Option<PathBuf>,
    pub daemon_wait: Duration,
    pub kill_after: Duration,
}

impl EnvBootConfig {
    /// The app's configuration: `$SHELL`, the cache in the Mainframe data dir
    /// (so an isolated `MAINFRAME_DATA_DIR` never touches the default cache).
    pub fn for_app() -> Self {
        Self {
            shell: shell_env::login_shell(),
            cache_path: Some(crate::log_sink::data_dir().join(cache::CACHE_FILE_NAME)),
            home: dirs::home_dir(),
            daemon_wait: DAEMON_ENV_WAIT,
            kill_after: shell_env::SHELL_KILL_AFTER,
        }
    }
}

#[derive(Clone)]
pub struct EnvBoot {
    inner: Arc<Inner>,
}

struct Inner {
    cached: Option<Env>,
    daemon_wait: Duration,
    shared: SharedEnv,
    state: Mutex<State>,
    refreshed: Condvar,
}

struct State {
    capture: Capture,
    /// Set once the daemon has taken its env.
    daemon_took: Option<EnvSource>,
}

enum Capture {
    Running,
    Done(Env),
    Failed,
}

impl EnvBoot {
    /// Read the cache and start the background capture. Never waits for the shell.
    pub fn start(config: EnvBootConfig) -> Self {
        let cached = config
            .cache_path
            .as_deref()
            .and_then(|path| cache::read(path, &config.shell, config.home.as_deref()));
        let initial = cached.clone().unwrap_or_else(build_fallback_env);
        let inner = Arc::new(Inner {
            cached,
            daemon_wait: config.daemon_wait,
            shared: SharedEnv::from(initial),
            state: Mutex::new(State {
                capture: Capture::Running,
                daemon_took: None,
            }),
            refreshed: Condvar::new(),
        });

        let worker = Arc::clone(&inner);
        let spawned = std::thread::Builder::new()
            .name("shell-env".into())
            .spawn(move || refresh(&worker, &config));
        if let Err(err) = spawned {
            tracing::warn!(error = %err, "could not start login-shell env capture");
            inner.finish(Capture::Failed);
        }
        Self { inner }
    }

    pub fn shared_env(&self) -> SharedEnv {
        self.inner.shared.clone()
    }

    /// The env to start the daemon with. Immediate with a valid cache;
    /// otherwise waits up to the configured wait for the capture.
    pub fn daemon_env(&self) -> (Env, EnvSource) {
        let started = Instant::now();
        let mut state = self.inner.lock();
        let (env, source) = if let Capture::Done(env) = &state.capture {
            // A fast shell finished before the launch: prefer it to the cache.
            (env.clone(), EnvSource::LoginShell)
        } else if let Some(cached) = &self.inner.cached {
            (cached.clone(), EnvSource::Cached)
        } else {
            state = self
                .inner
                .refreshed
                .wait_timeout_while(state, self.inner.daemon_wait, |s| {
                    matches!(s.capture, Capture::Running)
                })
                .map(|(guard, _)| guard)
                .unwrap_or_else(|e| e.into_inner().0);
            match &state.capture {
                Capture::Done(env) => (env.clone(), EnvSource::LoginShell),
                Capture::Failed => (build_fallback_env(), EnvSource::Fallback),
                Capture::Running => {
                    tracing::warn!(
                        wait_ms = self.inner.daemon_wait.as_millis() as u64,
                        "login-shell env not ready in time, starting the daemon with the fallback env"
                    );
                    (build_fallback_env(), EnvSource::Fallback)
                }
            }
        };
        state.daemon_took = Some(source);
        tracing::info!(
            source = source.as_str(),
            waited_ms = started.elapsed().as_millis() as u64,
            path_entries = env.get("PATH").map_or(0, |p| p.split(':').count()),
            "daemon env ready"
        );
        (env, source)
    }

    /// Test hook: wait until the background capture has finished.
    #[cfg(test)]
    pub fn wait_for_capture(&self, timeout: Duration) -> bool {
        let state = self.inner.lock();
        let (state, _) = self
            .inner
            .refreshed
            .wait_timeout_while(state, timeout, |s| matches!(s.capture, Capture::Running))
            .unwrap();
        !matches!(state.capture, Capture::Running)
    }
}

impl Inner {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Record the capture outcome and wake the daemon launch. Returns which env
    /// the daemon had already taken, if any.
    fn finish(&self, capture: Capture) -> Option<EnvSource> {
        let mut state = self.lock();
        state.capture = capture;
        let took = state.daemon_took;
        drop(state);
        self.refreshed.notify_all();
        took
    }
}

fn refresh(inner: &Inner, config: &EnvBootConfig) {
    let started_at = SystemTime::now();
    let started = Instant::now();
    tracing::info!(shell = %config.shell, "resolving login-shell environment");
    let env = match shell_env::capture_login_env(&config.shell, config.kill_after) {
        Ok(env) => env,
        Err(err) => {
            tracing::warn!(
                error = %err,
                shell = %config.shell,
                elapsed_ms = started.elapsed().as_millis() as u64,
                "login-shell env capture failed"
            );
            inner.finish(Capture::Failed);
            return;
        }
    };
    tracing::info!(
        keys = env.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        path_entries = env.get("PATH").map_or(0, |p| p.split(':').count()),
        "login-shell env captured"
    );

    if let Some(path) = &config.cache_path {
        if let Err(err) = cache::write(path, &config.shell, &env, started_at) {
            tracing::warn!(error = %err, path = %path.display(), "could not cache login-shell env");
        }
    }
    inner.shared.replace(env.clone());
    let changed = inner
        .cached
        .as_ref()
        .map(|cached| cache::changed_keys(cached, &env))
        .unwrap_or_default();

    match inner.finish(Capture::Done(env)) {
        Some(EnvSource::Cached) if !changed.is_empty() => tracing::info!(
            changed = ?changed,
            "login-shell env differs from the cache the daemon started with; it applies on the next daemon start"
        ),
        Some(EnvSource::Fallback) => tracing::info!(
            "login-shell env arrived after the daemon started with the fallback env; it applies on the next daemon start"
        ),
        _ => {}
    }
}

#[cfg(test)]
pub mod test_support;

#[cfg(test)]
mod tests;
