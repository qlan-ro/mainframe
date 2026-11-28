#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use super::test_support::{failing_shell, fake_shell, scratch_dir};
use super::*;
use crate::daemon_launch::{launch_with, DaemonSlot};
use crate::sidecar::DaemonHandle;

/// Matches the slow shell in the bug report (~5.5 s) plus margin.
const SLOW_SHELL_SECS: u32 = 6;
const FRESH: &str = "PATH=/fresh/bin:/usr/bin:/bin\nMF_SOURCE=fresh";
/// Generous bound for "did not wait for the shell" on a loaded CI runner.
const PROMPT: Duration = Duration::from_millis(1500);

fn config(dir: &Path, shell: &Path, daemon_wait: Duration) -> EnvBootConfig {
    EnvBootConfig {
        shell: shell.to_string_lossy().into_owned(),
        cache_path: Some(cache_path(dir)),
        home: Some(dir.join("home")),
        daemon_wait,
        kill_after: Duration::from_secs(20),
    }
}

fn cache_path(dir: &Path) -> PathBuf {
    dir.join("data").join(cache::CACHE_FILE_NAME)
}

fn seed_cache(dir: &Path, shell: &Path) {
    let env: Env = [
        ("PATH", "/cached/bin:/usr/bin:/bin"),
        ("MF_SOURCE", "cached"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    cache::write(
        &cache_path(dir),
        &shell.to_string_lossy(),
        &env,
        SystemTime::now(),
    )
    .unwrap();
}

fn read_cache(dir: &Path, shell: &Path) -> Option<Env> {
    cache::read(
        &cache_path(dir),
        &shell.to_string_lossy(),
        Some(&dir.join("home")),
    )
}

/// Launch the daemon the way `lib.rs` does, recording the env it was given.
fn launch(boot: &EnvBoot) -> (Env, EnvSource) {
    let slot = DaemonSlot::new();
    let mut seen = None;
    let launched = launch_with(&slot, boot, |env, source| {
        seen = Some((env.clone(), source));
        Ok(DaemonHandle::external())
    });
    assert!(matches!(launched, Some(Ok(_))));
    seen.expect("spawn was not called")
}

#[test]
fn slow_shell_with_cache_creates_window_first_and_starts_daemon_from_cache() {
    let dir = scratch_dir("cached");
    let shell = fake_shell(&dir, SLOW_SHELL_SECS, FRESH);
    seed_cache(&dir, &shell);
    let started = Instant::now();

    let boot = EnvBoot::start(config(&dir, &shell, DAEMON_ENV_WAIT));
    // `run()` builds the window right after `start` returns.
    let window_created = started.elapsed();
    let (env, source) = launch(&boot);
    let daemon_spawned = started.elapsed();

    assert!(
        window_created < PROMPT,
        "start blocked for {window_created:?}"
    );
    assert!(
        daemon_spawned < PROMPT,
        "daemon waited {daemon_spawned:?} despite a cache"
    );
    assert_eq!(source, EnvSource::Cached);
    assert_eq!(env["MF_SOURCE"], "cached");
    assert_eq!(boot.shared_env().snapshot()["MF_SOURCE"], "cached");

    assert!(
        boot.wait_for_capture(Duration::from_secs(20)),
        "capture never finished"
    );
    let env_resolved = started.elapsed();
    assert!(
        env_resolved >= Duration::from_secs(SLOW_SHELL_SECS.into()),
        "the fake shell returned early: {env_resolved:?}"
    );
    assert!(window_created < env_resolved && daemon_spawned < env_resolved);
    // The refresh rewrites the cache for the next launch and updates the env
    // new terminals use; the running daemon keeps its cached env.
    assert_eq!(read_cache(&dir, &shell).unwrap()["MF_SOURCE"], "fresh");
    assert_eq!(boot.shared_env().snapshot()["MF_SOURCE"], "fresh");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_capture_that_finished_before_the_launch_wins_over_the_cache() {
    let dir = scratch_dir("fast");
    let shell = fake_shell(&dir, 0, FRESH);
    seed_cache(&dir, &shell);

    let boot = EnvBoot::start(config(&dir, &shell, DAEMON_ENV_WAIT));
    assert!(boot.wait_for_capture(Duration::from_secs(10)));
    let (env, source) = launch(&boot);

    assert_eq!(source, EnvSource::LoginShell);
    assert_eq!(env["MF_SOURCE"], "fresh");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn without_cache_daemon_waits_for_the_login_shell_env() {
    let dir = scratch_dir("nocache");
    let shell = fake_shell(&dir, 1, FRESH);
    let started = Instant::now();

    let boot = EnvBoot::start(config(&dir, &shell, DAEMON_ENV_WAIT));
    assert!(started.elapsed() < PROMPT);
    let (env, source) = launch(&boot);

    assert!(
        started.elapsed() >= Duration::from_secs(1),
        "daemon did not wait for the shell"
    );
    assert_eq!(source, EnvSource::LoginShell);
    assert_eq!(env["MF_SOURCE"], "fresh");
    assert_eq!(env["PATH"], "/fresh/bin:/usr/bin:/bin");
    assert_eq!(read_cache(&dir, &shell).unwrap()["MF_SOURCE"], "fresh");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn slow_shell_without_cache_falls_back_after_the_wait_then_caches_the_late_capture() {
    let dir = scratch_dir("fallback");
    let shell = fake_shell(&dir, SLOW_SHELL_SECS, FRESH);
    let wait = Duration::from_secs(1);
    let started = Instant::now();

    let boot = EnvBoot::start(config(&dir, &shell, wait));
    let (env, source) = launch(&boot);
    let daemon_spawned = started.elapsed();

    assert!(
        daemon_spawned >= wait && daemon_spawned < wait + PROMPT,
        "spawned at {daemon_spawned:?}"
    );
    assert_eq!(source, EnvSource::Fallback);
    assert!(!env.contains_key("MF_SOURCE"));
    assert!(env.get("PATH").is_some_and(|p| !p.is_empty()));
    assert!(read_cache(&dir, &shell).is_none());

    // The capture that lands after the fallback is kept for the next launch.
    assert!(boot.wait_for_capture(Duration::from_secs(20)));
    assert_eq!(read_cache(&dir, &shell).unwrap()["MF_SOURCE"], "fresh");
    assert_eq!(boot.shared_env().snapshot()["MF_SOURCE"], "fresh");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn failing_shell_uses_the_fallback_without_waiting_and_caches_nothing() {
    let dir = scratch_dir("failing");
    let shell = failing_shell(&dir);
    let started = Instant::now();

    let boot = EnvBoot::start(config(&dir, &shell, DAEMON_ENV_WAIT));
    let (env, source) = launch(&boot);

    assert!(
        started.elapsed() < PROMPT,
        "waited for a shell that had already failed"
    );
    assert_eq!(source, EnvSource::Fallback);
    assert!(env.contains_key("PATH"));
    assert!(!cache_path(&dir).exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn quit_during_the_env_wait_never_spawns_the_daemon() {
    let dir = scratch_dir("quit");
    let shell = fake_shell(&dir, SLOW_SHELL_SECS, FRESH);
    let boot = EnvBoot::start(config(&dir, &shell, Duration::from_millis(200)));
    let slot = DaemonSlot::new();

    slot.close();
    let launched = launch_with(&slot, &boot, |_, _| panic!("spawned after quit"));

    assert!(launched.is_none());
    assert!(slot.get().is_none());
    let _ = std::fs::remove_dir_all(&dir);
}
