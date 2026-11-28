use std::path::Path;
use std::time::{Duration, SystemTime};

use super::*;
use crate::env_boot::test_support::scratch_dir;

const SHELL: &str = "/bin/zsh";

fn scope<'a>(home: Option<&'a Path>, base: &'a Env) -> CacheScope<'a> {
    CacheScope {
        shell: SHELL,
        home,
        base,
    }
}

fn env(pairs: &[(&str, &str)]) -> Env {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn sample() -> Env {
    env(&[
        ("PATH", "/opt/homebrew/bin:/usr/bin:/bin"),
        ("NVM_DIR", "/nvm"),
    ])
}

fn touch(path: &Path, at: SystemTime) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, "# profile\n").unwrap();
    filetime::set_file_mtime(path, filetime::FileTime::from_system_time(at)).unwrap();
}

#[test]
fn round_trips_a_capture() {
    let dir = scratch_dir("cache-rt");
    let path = dir.join("nested").join(CACHE_FILE_NAME);
    let home = dir.join("home");

    write(
        &path,
        &scope(None, &Env::new()),
        &sample(),
        SystemTime::now(),
        None,
    )
    .unwrap();

    assert_eq!(
        read(&path, &scope(Some(&home), &Env::new())),
        Some(sample())
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn is_written_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch_dir("cache-mode");
    let path = dir.join(CACHE_FILE_NAME);

    write(
        &path,
        &scope(None, &Env::new()),
        &sample(),
        SystemTime::now(),
        None,
    )
    .unwrap();

    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn missing_file_reads_as_none() {
    let dir = scratch_dir("cache-missing");
    assert_eq!(
        read(&dir.join(CACHE_FILE_NAME), &scope(None, &Env::new())),
        None
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ignores_a_capture_from_another_shell() {
    let dir = scratch_dir("cache-shell");
    let path = dir.join(CACHE_FILE_NAME);
    let bash = CacheScope {
        shell: "/bin/bash",
        home: None,
        base: &Env::new(),
    };
    write(&path, &bash, &sample(), SystemTime::now(), None).unwrap();

    assert_eq!(read(&path, &scope(None, &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ignores_malformed_other_version_and_pathless_files() {
    let dir = scratch_dir("cache-bad");
    let path = dir.join(CACHE_FILE_NAME);
    let now_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    for body in [
        "not json".to_string(),
        format!(
            r#"{{"version":99,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"PATH":"/bin"}}}}"#
        ),
        format!(
            r#"{{"version":2,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"HOME":"/h"}}}}"#
        ),
        format!(
            r#"{{"version":2,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"PATH":""}}}}"#
        ),
    ] {
        std::fs::write(&path, &body).unwrap();
        assert_eq!(
            read(&path, &scope(None, &Env::new())),
            None,
            "accepted {body}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_profile_edited_after_the_capture_invalidates_it() {
    let dir = scratch_dir("cache-stale");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let captured = SystemTime::now() - Duration::from_secs(3600);
    write(&path, &scope(None, &Env::new()), &sample(), captured, None).unwrap();

    touch(&home.join(".zprofile"), captured - Duration::from_secs(60));
    assert_eq!(
        read(&path, &scope(Some(&home), &Env::new())),
        Some(sample()),
        "an older profile invalidated the cache"
    );

    touch(&home.join(".zshrc"), captured + Duration::from_secs(60));
    assert_eq!(read(&path, &scope(Some(&home), &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn checks_zsh_files_in_the_cached_zdotdir() {
    let dir = scratch_dir("cache-zdotdir");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let zdotdir = dir.join("zdot");
    let captured = SystemTime::now() - Duration::from_secs(3600);
    let mut captured_env = sample();
    captured_env.insert("ZDOTDIR".into(), zdotdir.to_string_lossy().into_owned());
    write(
        &path,
        &scope(None, &Env::new()),
        &captured_env,
        captured,
        None,
    )
    .unwrap();

    touch(&zdotdir.join(".zshrc"), captured + Duration::from_secs(60));

    assert_eq!(read(&path, &scope(Some(&home), &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn changed_keys_names_real_changes_only() {
    let old = env(&[
        ("PATH", "/a"),
        ("PWD", "/x"),
        ("SHLVL", "1"),
        ("GONE", "1"),
        ("SAME", "s"),
    ]);
    let new = env(&[
        ("PATH", "/a:/b"),
        ("PWD", "/y"),
        ("SHLVL", "2"),
        ("ADDED", "1"),
        ("SAME", "s"),
    ]);

    assert_eq!(changed_keys(&old, &new), vec!["ADDED", "GONE", "PATH"]);
    assert!(changed_keys(&old, &old).is_empty());
}

#[test]
fn a_version_1_full_capture_is_ignored() {
    let dir = scratch_dir("cache-v1");
    let path = dir.join(CACHE_FILE_NAME);
    let now_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    std::fs::write(
        &path,
        format!(
            r#"{{"version":1,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"PATH":"/bin"}}}}"#
        ),
    )
    .unwrap();

    assert_eq!(read(&path, &scope(None, &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn app_owned_keys_are_never_written_or_read() {
    let dir = scratch_dir("cache-app-keys");
    let path = dir.join(CACHE_FILE_NAME);
    let mut captured = sample();
    captured.insert("MAINFRAME_MCP_TOKEN".into(), "token".into());
    captured.insert("SHLVL".into(), "2".into());

    write(
        &path,
        &scope(None, &Env::new()),
        &captured,
        SystemTime::now(),
        None,
    )
    .unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(
        !raw.contains("MAINFRAME_MCP_TOKEN") && !raw.contains("SHLVL"),
        "{raw}"
    );

    // A file that holds them anyway (written by hand or by an older build).
    let now_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    std::fs::write(
        &path,
        format!(
            r#"{{"version":2,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"PATH":"/bin","MAINFRAME_DATA_DIR":"/x","DAEMON_PORT":"1"}}}}"#
        ),
    )
    .unwrap();
    assert_eq!(
        read(&path, &scope(None, &Env::new())),
        Some(env(&[("PATH", "/bin")]))
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A profile that points `SSH_AUTH_SOCK` at 1Password, Secretive or gpg-agent
/// keeps that socket across launches while it exists.
#[test]
fn a_profile_ssh_agent_socket_that_still_exists_survives() {
    let dir = scratch_dir("cache-ssh-live");
    let path = dir.join(CACHE_FILE_NAME);
    let sock = dir.join("agent.sock");
    std::fs::write(&sock, "").unwrap();
    let mut captured = sample();
    captured.insert("SSH_AUTH_SOCK".into(), sock.to_string_lossy().into_owned());

    write(
        &path,
        &scope(None, &Env::new()),
        &captured,
        SystemTime::now(),
        None,
    )
    .unwrap();

    assert_eq!(read(&path, &scope(None, &Env::new())), Some(captured));
    let _ = std::fs::remove_dir_all(&dir);
}

/// `eval $(ssh-agent)` in a profile: after a reboot the cached socket is gone,
/// so it and its agent pid are dropped and the inherited socket applies.
#[test]
fn a_cached_ssh_agent_socket_that_is_gone_is_dropped() {
    let dir = scratch_dir("cache-ssh-dead");
    let path = dir.join(CACHE_FILE_NAME);
    let mut captured = sample();
    captured.insert(
        "SSH_AUTH_SOCK".into(),
        dir.join("gone.sock").to_string_lossy().into_owned(),
    );
    captured.insert("SSH_AGENT_PID".into(), "4242".into());

    write(
        &path,
        &scope(None, &Env::new()),
        &captured,
        SystemTime::now(),
        None,
    )
    .unwrap();

    assert_eq!(read(&path, &scope(None, &Env::new())), Some(sample()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_exported_claude_code_setting_survives() {
    let dir = scratch_dir("cache-bedrock");
    let path = dir.join(CACHE_FILE_NAME);
    let mut captured = sample();
    captured.insert("CLAUDE_CODE_USE_BEDROCK".into(), "1".into());
    captured.insert("CLAUDE_CODE_USE_VERTEX".into(), "0".into());

    write(
        &path,
        &scope(None, &Env::new()),
        &captured,
        SystemTime::now(),
        None,
    )
    .unwrap();

    let read_back = read(&path, &scope(None, &Env::new())).unwrap();
    assert_eq!(read_back["CLAUDE_CODE_USE_BEDROCK"], "1");
    assert_eq!(read_back["CLAUDE_CODE_USE_VERTEX"], "0");
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn overwriting_keeps_the_file_owner_only_despite_a_leftover_temp_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch_dir("cache-overwrite");
    let path = dir.join(CACHE_FILE_NAME);
    std::fs::write(&path, "old").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    // A crash mid-write left a world-readable temp file behind.
    let leftover = tmp_path(&path);
    std::fs::write(&leftover, "partial").unwrap();
    std::fs::set_permissions(&leftover, std::fs::Permissions::from_mode(0o644)).unwrap();

    write(
        &path,
        &scope(None, &Env::new()),
        &sample(),
        SystemTime::now(),
        None,
    )
    .unwrap();

    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(!leftover.exists());
    assert_eq!(read(&path, &scope(None, &Env::new())), Some(sample()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn changed_keys_ignores_capture_made_keys() {
    let old = env(&[("PATH", "/a"), ("SHLVL", "1"), ("MAINFRAME_X", "1")]);
    let new = env(&[("PATH", "/a"), ("SHLVL", "2"), ("MAINFRAME_X", "2")]);
    assert!(changed_keys(&old, &new).is_empty());
}

fn set_mtime(path: &Path, at: SystemTime) {
    filetime::set_file_mtime(path, filetime::FileTime::from_system_time(at)).unwrap();
}

#[test]
fn fish_conf_d_entries_under_xdg_config_home_invalidate_it() {
    let dir = scratch_dir("cache-fish-confd");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let xdg = dir.join("xdg");
    let base = env(&[("XDG_CONFIG_HOME", xdg.to_str().unwrap())]);
    let captured = SystemTime::now() - Duration::from_secs(3600);
    let before = captured - Duration::from_secs(60);
    let later = captured + Duration::from_secs(60);
    let entry = xdg.join("fish/conf.d/nvm.fish");
    touch(&entry, before);
    set_mtime(&xdg.join("fish/conf.d"), before);
    write(&path, &scope(Some(&home), &base), &sample(), captured, None).unwrap();

    // Under ~/.config, which XDG_CONFIG_HOME overrides: ignored.
    touch(&home.join(".config/fish/config.fish"), later);
    assert_eq!(read(&path, &scope(Some(&home), &base)), Some(sample()));

    // Edit an existing conf.d entry: the directory's own mtime stays old, so
    // only the per-entry check can catch it.
    std::fs::write(&entry, "set -gx PATH /nvm/bin $PATH\n").unwrap();
    set_mtime(&entry, later);
    set_mtime(&xdg.join("fish/conf.d"), before);
    assert_eq!(read(&path, &scope(Some(&home), &base)), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn only_exported_fish_universal_variables_invalidate_it() {
    let dir = scratch_dir("cache-fish-vars");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let vars = home.join(".config/fish/fish_variables");
    std::fs::create_dir_all(vars.parent().unwrap()).unwrap();
    let write_vars = |body: &str| {
        std::fs::write(&vars, body).unwrap();
        // Always newer than the capture: the mtime alone must not matter.
        set_mtime(&vars, SystemTime::now() + Duration::from_secs(60));
    };
    write_vars("# fish\nSETUVAR --export EDITOR:vim\nSETUVAR fish_greeting:hi\n");
    write(
        &path,
        &scope(Some(&home), &Env::new()),
        &sample(),
        SystemTime::now(),
        None,
    )
    .unwrap();

    write_vars("# fish\nSETUVAR --export EDITOR:vim\nSETUVAR fish_greeting:hello\n");
    assert_eq!(
        read(&path, &scope(Some(&home), &Env::new())),
        Some(sample())
    );

    write_vars("# fish\nSETUVAR --export EDITOR:nvim\nSETUVAR fish_greeting:hello\n");
    assert_eq!(read(&path, &scope(Some(&home), &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}

/// `fish_add_path` stores `fish_user_paths` as a non-exported universal
/// variable that fish prepends to PATH, so a change to it must invalidate.
#[test]
fn fish_user_paths_changes_invalidate_it() {
    let dir = scratch_dir("cache-fish-user-paths");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let vars = home.join(".config/fish/fish_variables");
    std::fs::create_dir_all(vars.parent().unwrap()).unwrap();
    std::fs::write(
        &vars,
        "SETUVAR fish_user_paths:/opt/a\nSETUVAR fish_greeting:hi\n",
    )
    .unwrap();
    write(
        &path,
        &scope(Some(&home), &Env::new()),
        &sample(),
        SystemTime::now(),
        None,
    )
    .unwrap();
    assert_eq!(
        read(&path, &scope(Some(&home), &Env::new())),
        Some(sample())
    );

    std::fs::write(
        &vars,
        "SETUVAR fish_user_paths:/opt/a\x1e/opt/b\nSETUVAR fish_greeting:hi\n",
    )
    .unwrap();
    assert_eq!(read(&path, &scope(Some(&home), &Env::new())), None);

    // With flags too (`--path` is what newer fish writes).
    std::fs::write(&vars, "SETUVAR --path fish_user_paths:/opt/a\n").unwrap();
    write(
        &path,
        &scope(Some(&home), &Env::new()),
        &sample(),
        SystemTime::now(),
        None,
    )
    .unwrap();
    std::fs::write(&vars, "SETUVAR --path fish_user_paths:/opt/c\n").unwrap();
    assert_eq!(read(&path, &scope(Some(&home), &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fish_line_classification() {
    assert!(fish_line_affects_env("SETUVAR --export EDITOR:vim"));
    assert!(fish_line_affects_env("SETUVAR --export --path GOPATH:/g"));
    assert!(fish_line_affects_env("SETUVAR fish_user_paths:/a"));
    assert!(fish_line_affects_env("SETUVAR --path fish_user_paths:/a"));
    assert!(!fish_line_affects_env("SETUVAR fish_greeting:hi"));
    assert!(!fish_line_affects_env("SETUVAR fish_user_paths_extra:/a"));
    assert!(!fish_line_affects_env(
        "# This file contains fish universal variable definitions."
    ));
}

/// A cached socket path that is now a dangling symlink counts as gone.
#[cfg(unix)]
#[test]
fn a_cached_ssh_agent_symlink_to_a_missing_socket_is_dropped() {
    let dir = scratch_dir("cache-ssh-dangling");
    let path = dir.join(CACHE_FILE_NAME);
    let link = dir.join("agent.sock");
    std::os::unix::fs::symlink(dir.join("missing-target.sock"), &link).unwrap();
    let mut captured = sample();
    captured.insert("SSH_AUTH_SOCK".into(), link.to_string_lossy().into_owned());

    write(
        &path,
        &scope(None, &Env::new()),
        &captured,
        SystemTime::now(),
        None,
    )
    .unwrap();

    assert_eq!(read(&path, &scope(None, &Env::new())), Some(sample()));
    let _ = std::fs::remove_dir_all(&dir);
}

/// The fish digest is taken when the capture starts: an exported change made
/// while the shell runs is not recorded as already seen.
#[test]
fn a_fish_change_during_the_capture_is_not_recorded_as_seen() {
    let dir = scratch_dir("cache-fish-snapshot");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let vars = home.join(".config/fish/fish_variables");
    std::fs::create_dir_all(vars.parent().unwrap()).unwrap();
    std::fs::write(&vars, "SETUVAR --export EDITOR:vim\n").unwrap();
    let at_start = fish_snapshot(&scope(Some(&home), &Env::new()));

    std::fs::write(&vars, "SETUVAR --export EDITOR:nvim\n").unwrap();
    write(
        &path,
        &scope(Some(&home), &Env::new()),
        &sample(),
        SystemTime::now(),
        Some(&at_start),
    )
    .unwrap();

    assert_eq!(read(&path, &scope(Some(&home), &Env::new())), None);
    let _ = std::fs::remove_dir_all(&dir);
}
