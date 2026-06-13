use super::*;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

#[test]
fn validate_cwd_rejects_non_directory() {
    let f = std::env::current_exe().unwrap();
    assert!(validate_cwd(f.to_str().unwrap()).is_err());
}

#[test]
fn validate_cwd_accepts_directory() {
    let d = std::env::temp_dir();
    assert!(validate_cwd(d.to_str().unwrap()).is_ok());
}

#[test]
fn validate_cwd_rejects_missing_path() {
    assert!(validate_cwd("/no/such/dir/xyzzy-12345").is_err());
}

/// Killing a session terminates its reader thread (on_exit fires) and makes
/// the session unreachable (a subsequent write errors). Asserts the
/// load-bearing kill→EOF mechanism, not just map emptiness.
#[test]
fn manager_kill_fires_exit_and_makes_session_unwritable() {
    let mgr = TerminalManager::new(test_env());
    let (etx, erx) = channel::<Option<i32>>();
    let dir = std::env::temp_dir();
    mgr.spawn("t1", dir.to_str().unwrap(), 80, 24,
        move |_bytes| {},
        move |code| { let _ = etx.send(code); }).unwrap();
    assert!(mgr.write("t1", "true\n").is_ok());

    mgr.kill("t1");

    assert!(
        erx.recv_timeout(Duration::from_secs(5)).is_ok(),
        "on_exit did not fire after kill — reader thread leaked",
    );
    assert!(mgr.write("t1", "x").is_err());
    assert_eq!(mgr.count(), 0);
}

/// kill_all terminates every reader thread (each on_exit fires) and empties
/// the map.
#[test]
fn kill_all_fires_every_exit_and_clears() {
    let mgr = TerminalManager::new(test_env());
    let dir = std::env::temp_dir();
    let mut exit_rxs = Vec::new();
    for id in ["a", "b"] {
        let (etx, erx) = channel::<Option<i32>>();
        mgr.spawn(id, dir.to_str().unwrap(), 80, 24, |_| {}, move |c| { let _ = etx.send(c); }).unwrap();
        exit_rxs.push(erx);
    }
    assert_eq!(mgr.count(), 2);

    mgr.kill_all();

    for erx in &exit_rxs {
        assert!(
            erx.recv_timeout(Duration::from_secs(5)).is_ok(),
            "an on_exit did not fire after kill_all — a reader thread leaked",
        );
    }
    assert!(mgr.write("a", "x").is_err());
    assert!(mgr.write("b", "x").is_err());
    assert_eq!(mgr.count(), 0);
}

/// A child that exits immediately on its own (no kill) must NOT leave a
/// permanently-dead, still-counted entry — the reader-vs-insert race (C3).
#[test]
fn self_exiting_child_is_reaped_not_left_dead() {
    let mgr = TerminalManager::new(test_env());
    let (etx, erx) = channel::<Option<i32>>();
    let dir = std::env::temp_dir();
    mgr.spawn("z", dir.to_str().unwrap(), 80, 24, |_| {}, move |c| { let _ = etx.send(c); }).unwrap();
    let _ = mgr.write("z", "exit\n");
    assert!(erx.recv_timeout(Duration::from_secs(5)).is_ok(), "self-exit never signalled");
    let deadline = Instant::now() + Duration::from_secs(2);
    while mgr.count() != 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(mgr.count(), 0, "self-exited child left a dead entry");
}

#[test]
fn reader_forwards_output_then_signals_exit() {
    let mgr = TerminalManager::new(test_env());
    let (dtx, drx) = channel::<Vec<u8>>();
    let (etx, erx) = channel::<Option<i32>>();
    let dir = std::env::temp_dir();
    mgr.spawn("echo1", dir.to_str().unwrap(), 80, 24,
        move |b| { let _ = dtx.send(b); },
        move |c| { let _ = etx.send(c); }).unwrap();
    mgr.write("echo1", "printf MARKER; exit\n").unwrap();
    let mut acc = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(chunk) = drx.recv_timeout(Duration::from_millis(200)) {
            acc.extend_from_slice(&chunk);
            if String::from_utf8_lossy(&acc).contains("MARKER") { break; }
        }
    }
    assert!(String::from_utf8_lossy(&acc).contains("MARKER"), "no MARKER in {:?}", String::from_utf8_lossy(&acc));
    assert!(erx.recv_timeout(Duration::from_secs(5)).is_ok());
}

/// validate_cwd now returns the canonicalized PathBuf, not just ().
/// --- Canonicalization tests ---

/// Accepting a real directory returns its canonical PathBuf.
#[test]
fn validate_cwd_returns_canonical_path_for_real_dir() {
    let d = std::env::temp_dir();
    let canonical = std::fs::canonicalize(&d).unwrap();
    let result = validate_cwd(d.to_str().unwrap());
    assert!(result.is_ok(), "expected Ok for real dir, got {:?}", result.err());
    assert_eq!(result.unwrap(), canonical);
}

/// A symlink pointing at a real directory resolves and is accepted;
/// the returned path is the target (canonical), not the symlink itself.
#[test]
#[cfg(unix)]
fn validate_cwd_accepts_symlink_to_dir_and_resolves_it() {
    let base = std::env::temp_dir().join(format!("mf_symlink_test_{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let target = base.join("real_dir");
    std::fs::create_dir_all(&target).unwrap();
    let link = base.join("link_to_dir");
    // Clean up any leftover from a previous run.
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(&target, &link).unwrap();

    let result = validate_cwd(link.to_str().unwrap());

    // Capture the canonical path of the target BEFORE cleanup so it is still resolvable.
    let canonical = std::fs::canonicalize(&target).unwrap_or_else(|_| target.clone());

    // Cleanup after capturing the canonical path.
    let _ = std::fs::remove_dir_all(&base);

    assert!(result.is_ok(), "expected symlink to dir to be accepted, got {:?}", result.err());
    assert_eq!(result.unwrap(), canonical);
}

/// A path containing `..` components is resolved to the canonical form.
#[test]
fn validate_cwd_resolves_dotdot_components() {
    let tmp = std::env::temp_dir();
    // Build a path like /tmp/subdir/../ which exists but isn't normalized.
    let sub = tmp.join("mf_dotdot_test");
    std::fs::create_dir_all(&sub).unwrap();
    let dotdot_path = format!("{}/mf_dotdot_test/..", tmp.to_str().unwrap());
    let result = validate_cwd(&dotdot_path);
    let _ = std::fs::remove_dir_all(&sub);

    assert!(result.is_ok(), "expected dotdot path to be accepted, got {:?}", result.err());
    let canonical_tmp = std::fs::canonicalize(&tmp).unwrap();
    assert_eq!(result.unwrap(), canonical_tmp);
}

fn test_env() -> HashMap<String, String> {
    let mut e = HashMap::new();
    e.insert("SHELL".to_string(), "/bin/zsh".to_string());
    if let Ok(p) = std::env::var("PATH") { e.insert("PATH".to_string(), p); }
    e
}
