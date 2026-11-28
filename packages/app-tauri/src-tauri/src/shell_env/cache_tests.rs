use std::path::Path;
use std::time::{Duration, SystemTime};

use super::*;
use crate::env_boot::test_support::scratch_dir;

const SHELL: &str = "/bin/zsh";

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

    write(&path, SHELL, &sample(), SystemTime::now()).unwrap();

    assert_eq!(read(&path, SHELL, Some(&home), &Env::new()), Some(sample()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn is_written_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch_dir("cache-mode");
    let path = dir.join(CACHE_FILE_NAME);

    write(&path, SHELL, &sample(), SystemTime::now()).unwrap();

    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn missing_file_reads_as_none() {
    let dir = scratch_dir("cache-missing");
    assert_eq!(
        read(&dir.join(CACHE_FILE_NAME), SHELL, None, &Env::new()),
        None
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ignores_a_capture_from_another_shell() {
    let dir = scratch_dir("cache-shell");
    let path = dir.join(CACHE_FILE_NAME);
    write(&path, "/bin/bash", &sample(), SystemTime::now()).unwrap();

    assert_eq!(read(&path, SHELL, None, &Env::new()), None);
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
            read(&path, SHELL, None, &Env::new()),
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
    write(&path, SHELL, &sample(), captured).unwrap();

    touch(&home.join(".zprofile"), captured - Duration::from_secs(60));
    assert_eq!(
        read(&path, SHELL, Some(&home), &Env::new()),
        Some(sample()),
        "an older profile invalidated the cache"
    );

    touch(&home.join(".zshrc"), captured + Duration::from_secs(60));
    assert_eq!(read(&path, SHELL, Some(&home), &Env::new()), None);
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
    write(&path, SHELL, &captured_env, captured).unwrap();

    touch(&zdotdir.join(".zshrc"), captured + Duration::from_secs(60));

    assert_eq!(read(&path, SHELL, Some(&home), &Env::new()), None);
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

    assert_eq!(read(&path, SHELL, None, &Env::new()), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn session_scoped_keys_are_never_written_or_read() {
    let dir = scratch_dir("cache-session");
    let path = dir.join(CACHE_FILE_NAME);
    let mut captured = sample();
    captured.insert("SSH_AUTH_SOCK".into(), "/old".into());
    captured.insert("MAINFRAME_MCP_TOKEN".into(), "token".into());

    write(&path, SHELL, &captured, SystemTime::now()).unwrap();
    let raw = std::fs::read_to_string(&path).unwrap();
    assert!(
        !raw.contains("SSH_AUTH_SOCK") && !raw.contains("MAINFRAME_MCP_TOKEN"),
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
            r#"{{"version":2,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"PATH":"/bin","SSH_AUTH_SOCK":"/old","TERM_SESSION_ID":"w0"}}}}"#
        ),
    )
    .unwrap();
    assert_eq!(
        read(&path, SHELL, None, &Env::new()),
        Some(env(&[("PATH", "/bin")]))
    );
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

    write(&path, SHELL, &sample(), SystemTime::now()).unwrap();

    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(!leftover.exists());
    assert_eq!(read(&path, SHELL, None, &Env::new()), Some(sample()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fish_files_under_xdg_config_home_invalidate_it() {
    let dir = scratch_dir("cache-fish");
    let path = dir.join(CACHE_FILE_NAME);
    let home = dir.join("home");
    let xdg = dir.join("xdg");
    let base = env(&[("XDG_CONFIG_HOME", xdg.to_str().unwrap())]);
    let captured = SystemTime::now() - Duration::from_secs(3600);
    let later = captured + Duration::from_secs(60);
    write(&path, SHELL, &sample(), captured).unwrap();

    // Under ~/.config, which XDG_CONFIG_HOME overrides: ignored.
    touch(&home.join(".config/fish/config.fish"), later);
    assert_eq!(read(&path, SHELL, Some(&home), &base), Some(sample()));

    for file in ["fish/fish_variables", "fish/conf.d/nvm.fish"] {
        touch(&xdg.join(file), later);
        assert_eq!(read(&path, SHELL, Some(&home), &base), None, "{file}");
        let _ = std::fs::remove_dir_all(&xdg);
    }
    // Without XDG_CONFIG_HOME, ~/.config/fish counts.
    assert_eq!(read(&path, SHELL, Some(&home), &Env::new()), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn changed_keys_ignores_session_scoped_keys() {
    let old = env(&[("PATH", "/a"), ("SSH_AUTH_SOCK", "/x")]);
    let new = env(&[("PATH", "/a"), ("SSH_AUTH_SOCK", "/y")]);
    assert!(changed_keys(&old, &new).is_empty());
}
