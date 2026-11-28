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
        base_env: Env::new(),
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
    let shell = shell.to_string_lossy();
    let scope = cache::CacheScope {
        shell: &shell,
        home: None,
        base: &Env::new(),
    };
    cache::write(&cache_path(dir), &scope, &env, SystemTime::now(), None).unwrap();
}

fn read_cache(dir: &Path, shell: &Path) -> Option<Env> {
    let shell = shell.to_string_lossy();
    let home = dir.join("home");
    let scope = cache::CacheScope {
        shell: &shell,
        home: Some(&home),
        base: &Env::new(),
    };
    cache::read(&cache_path(dir), &scope)
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
    let wait = Duration::from_secs(3);
    let mut config = config(&dir, &shell, wait);
    // Kill the shell after the quit so its late capture cannot recreate `dir`.
    config.kill_after = Duration::from_secs(1);
    let boot = EnvBoot::start(config);
    let slot = DaemonSlot::new();
    let started = Instant::now();

    std::thread::scope(|scope| {
        // No cache and a slow shell: the launch blocks in `daemon_env`.
        let launch = scope
            .spawn(|| launch_with(&slot, &boot, |_, _| panic!("spawned after quit")).is_none());
        std::thread::sleep(Duration::from_millis(300));
        assert!(!launch.is_finished(), "the launch did not wait for the env");
        slot.close(); // quit begins while the launch is still waiting
        assert!(started.elapsed() < wait);
        assert!(launch.join().expect("the launch spawned the daemon"));
    });

    assert!(slot.get().is_none());
    assert_eq!(slot.status(), "exited");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The cache must never replay a per-boot value. With a stale cache holding
/// `SSH_AUTH_SOCK=/old` (an agent from an earlier boot, its socket now gone)
/// and the live process holding `/new`, the spawned daemon sees `/new`, plus
/// the cached shell additions and the handover argument.
#[test]
fn daemon_gets_the_live_ssh_agent_socket_not_the_cached_one() {
    let dir = scratch_dir("ssh-sock");
    let shell = fake_shell(&dir, SLOW_SHELL_SECS, FRESH);
    let live_sock = format!(
        "/private/tmp/com.apple.launchd.new-{}/Listeners",
        std::process::id()
    );
    // Only this test reads or sets SSH_AUTH_SOCK in this test binary; the
    // guard puts the original value back even if an assertion fails.
    let _restore = EnvVarGuard::set("SSH_AUTH_SOCK", &live_sock);
    let now_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let cache_file = cache_path(&dir);
    std::fs::create_dir_all(cache_file.parent().unwrap()).unwrap();
    std::fs::write(
        &cache_file,
        format!(
            r#"{{"version":2,"shell":"{}","captured_at_ms":{now_ms},"env":{{"PATH":"/cached/bin:/usr/bin:/bin","MF_SOURCE":"cached","SSH_AUTH_SOCK":"/old"}}}}"#,
            shell.display()
        ),
    )
    .unwrap();
    let out = dir.join("daemon-env.txt");
    let daemon = dir.join("fake-daemon");
    std::fs::write(
        &daemon,
        format!(
            "#!/bin/sh\n{{ env; echo \"ARGS=$*\"; }} > '{}'\n",
            out.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&daemon, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut config = config(&dir, &shell, DAEMON_ENV_WAIT);
    config.base_env = std::env::vars().collect();
    // The cache answers at once; the slow capture is killed before it could
    // rewrite the cache after `dir` is removed.
    config.kill_after = Duration::from_secs(1);
    let boot = EnvBoot::start(config);
    let slot = DaemonSlot::new();
    let launched = launch_with(&slot, &boot, |env, source| {
        assert_eq!(source, EnvSource::Cached);
        crate::sidecar::spawn_daemon(crate::sidecar::SidecarConfig {
            program: crate::sidecar::DaemonProgram {
                daemon_bin: daemon.clone(),
            },
            shell_env: env.clone(),
            shell_env_resolved: true,
            daemon_port: 31599,
            data_dir: Some(dir.join("data")),
        })
    });
    assert!(matches!(launched, Some(Ok(_))));

    let deadline = Instant::now() + Duration::from_secs(5);
    let dumped = loop {
        if let Ok(text) = std::fs::read_to_string(&out) {
            if text.contains("ARGS=") {
                break text;
            }
        }
        assert!(Instant::now() < deadline, "the fake daemon never ran");
        std::thread::sleep(Duration::from_millis(20));
    };
    let lines: Vec<&str> = dumped.lines().collect();
    assert!(
        lines.contains(&format!("SSH_AUTH_SOCK={live_sock}").as_str()),
        "{dumped}"
    );
    assert!(!lines.contains(&"SSH_AUTH_SOCK=/old"), "{dumped}");
    assert!(lines.contains(&"MF_SOURCE=cached"), "{dumped}");
    assert!(
        lines.contains(&"PATH=/cached/bin:/usr/bin:/bin"),
        "{dumped}"
    );
    assert!(
        lines
            .iter()
            .any(|l| l.starts_with("ARGS=") && l.contains("--shell-env-resolved")),
        "{dumped}"
    );
    // Terminals get the same overlay: no stale socket either.
    assert!(!boot.shared_env().snapshot().contains_key("SSH_AUTH_SOCK"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// Restores an env var on drop.
struct EnvVarGuard {
    key: &'static str,
    original: Option<std::ffi::OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: &str) -> Self {
        let original = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.original {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

/// A profile that points `SSH_AUTH_SOCK` at its own agent (1Password,
/// Secretive, gpg-agent) or exports `CLAUDE_CODE_USE_BEDROCK` keeps both: from
/// the capture into the cache, and from the cache into the next daemon env.
#[test]
fn profile_set_agent_socket_and_claude_code_settings_survive_the_cache() {
    let dir = scratch_dir("profile-values");
    let agent = dir.join("1password-agent.sock");
    std::fs::write(&agent, "").unwrap();
    let lines = format!(
        "PATH=/fresh/bin:/usr/bin:/bin\nSSH_AUTH_SOCK={}\nCLAUDE_CODE_USE_BEDROCK=1",
        agent.display()
    );
    let shell = fake_shell(&dir, 0, &lines);
    let base: Env = [(
        "SSH_AUTH_SOCK",
        "/private/tmp/com.apple.launchd.x/Listeners",
    )]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();

    let mut first = config(&dir, &shell, DAEMON_ENV_WAIT);
    first.base_env = base.clone();
    let boot = EnvBoot::start(first);
    assert!(boot.wait_for_capture(Duration::from_secs(10)));
    let cached = read_cache(&dir, &shell).expect("capture was not cached");
    assert_eq!(cached["SSH_AUTH_SOCK"], agent.to_string_lossy());
    assert_eq!(cached["CLAUDE_CODE_USE_BEDROCK"], "1");

    // Next launch, same shell path, now slow: the daemon starts from the cache.
    std::fs::write(
        &shell,
        format!("#!/bin/sh\nsleep {SLOW_SHELL_SECS}\necho PATH=/usr/bin\n"),
    )
    .unwrap();
    let mut second = config(&dir, &shell, DAEMON_ENV_WAIT);
    second.base_env = base;
    second.kill_after = Duration::from_secs(1);
    let (env, source) = launch(&EnvBoot::start(second));
    assert_eq!(source, EnvSource::Cached);
    assert_eq!(env["SSH_AUTH_SOCK"], agent.to_string_lossy());
    assert_eq!(env["CLAUDE_CODE_USE_BEDROCK"], "1");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A launch from a terminal inherits most of the profile, so its delta is
/// near-empty: it is used in memory but never written over the cache.
#[test]
fn a_launch_from_a_terminal_does_not_write_the_cache() {
    let dir = scratch_dir("terminal-launch");
    let shell = fake_shell(&dir, 0, FRESH);
    let mut config = config(&dir, &shell, DAEMON_ENV_WAIT);
    config.base_env = [("SHLVL", "1"), ("TERM_PROGRAM", "Apple_Terminal")]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let boot = EnvBoot::start(config);
    let (env, source) = launch(&boot);

    assert_eq!(source, EnvSource::LoginShell);
    assert_eq!(env["MF_SOURCE"], "fresh");
    assert!(!cache_path(&dir).exists());
    let _ = std::fs::remove_dir_all(&dir);
}
