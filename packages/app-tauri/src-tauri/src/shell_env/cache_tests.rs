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

    assert_eq!(read(&path, SHELL, Some(&home)), Some(sample()));
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
    assert_eq!(read(&dir.join(CACHE_FILE_NAME), SHELL, None), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ignores_a_capture_from_another_shell() {
    let dir = scratch_dir("cache-shell");
    let path = dir.join(CACHE_FILE_NAME);
    write(&path, "/bin/bash", &sample(), SystemTime::now()).unwrap();

    assert_eq!(read(&path, SHELL, None), None);
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
            r#"{{"version":1,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"HOME":"/h"}}}}"#
        ),
        format!(
            r#"{{"version":1,"shell":"{SHELL}","captured_at_ms":{now_ms},"env":{{"PATH":""}}}}"#
        ),
    ] {
        std::fs::write(&path, &body).unwrap();
        assert_eq!(read(&path, SHELL, None), None, "accepted {body}");
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
        read(&path, SHELL, Some(&home)),
        Some(sample()),
        "an older profile invalidated the cache"
    );

    touch(&home.join(".zshrc"), captured + Duration::from_secs(60));
    assert_eq!(read(&path, SHELL, Some(&home)), None);
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

    assert_eq!(read(&path, SHELL, Some(&home)), None);
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
