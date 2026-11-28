//! Killing a login-shell capture and everything its start-up files launched.
//!
//! The capture shell runs as the leader of its own session (`setsid`), so every
//! process it starts carries the shell's pid as its session id, including
//! `bash -i` jobs, which job control puts in process groups of their own, and
//! children already reparented after the shell exited. Killing by session
//! catches all of them; killing only the shell's process group would not. The
//! kernel does not reuse a pid while it is still a session id, so the match
//! never reaches an unrelated process.

/// Passes over the process table; a member forked between scans is caught by
/// the next one.
#[cfg(unix)]
const MAX_PASSES: usize = 3;

/// SIGKILL every process in the session `leader` leads, and their groups,
/// repeating until a pass finds nothing (at most [`MAX_PASSES`]). Returns how
/// many member processes the first pass found (the leader included).
#[cfg(unix)]
pub fn kill_session(leader: u32) -> usize {
    let Ok(leader) = libc::pid_t::try_from(leader) else {
        return 0;
    };
    if leader <= 1 {
        return 0;
    }
    let first = kill_pass(leader);
    let mut found = first;
    for _ in 1..MAX_PASSES {
        if found == 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        found = kill_pass(leader);
    }
    first
}

/// One scan: SIGKILL each live member and its group. Returns how many live
/// members it found; killed processes awaiting reaping are not counted.
#[cfg(unix)]
fn kill_pass(leader: libc::pid_t) -> usize {
    let own_pid = std::process::id() as libc::pid_t;
    // SAFETY: `getpgrp` has no preconditions.
    let own_group = unsafe { libc::getpgrp() };
    let mut groups = vec![leader];
    let mut found = 0;
    for pid in all_pids() {
        // SAFETY: `getsid`/`getpgid`/`kill` are plain syscalls on a pid value;
        // a pid that has exited in the meantime just yields an error.
        unsafe {
            if pid <= 1 || pid == own_pid || libc::getsid(pid) != leader || is_zombie(pid) {
                continue;
            }
            found += 1;
            let group = libc::getpgid(pid);
            if group > 1 && group != own_group && !groups.contains(&group) {
                groups.push(group);
            }
            libc::kill(pid, libc::SIGKILL);
        }
    }
    for group in groups {
        // SAFETY: a negative pid signals the whole process group.
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
    found
}

/// A killed process that has not been reaped yet: nothing left to kill.
#[cfg(target_os = "macos")]
fn is_zombie(pid: libc::pid_t) -> bool {
    // SAFETY: `proc_bsdinfo` is plain data; all-zero is a valid value.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: `info` is a writable `proc_bsdinfo` of exactly `size` bytes.
    let got = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    got == size && info.pbi_status == libc::SZOMB
}

#[cfg(target_os = "linux")]
fn is_zombie(pid: libc::pid_t) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| {
            stat.rsplit_once(')')
                .map(|(_, rest)| rest.trim_start().starts_with('Z'))
        })
        .unwrap_or(false)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn is_zombie(_pid: libc::pid_t) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn all_pids() -> Vec<libc::pid_t> {
    let size = std::mem::size_of::<libc::pid_t>();
    // SAFETY: a null buffer asks for the current number of pids.
    let needed = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if needed <= 0 {
        return Vec::new();
    }
    let mut pids = vec![0 as libc::pid_t; needed as usize + 64];
    let bytes = libc::c_int::try_from(pids.len() * size).unwrap_or(libc::c_int::MAX);
    // SAFETY: the buffer is `bytes` long and lives across the call.
    let count = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
    pids.truncate(usize::try_from(count).unwrap_or(0).min(pids.len()));
    pids
}

#[cfg(target_os = "linux")]
fn all_pids() -> Vec<libc::pid_t> {
    std::fs::read_dir("/proc")
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| entry.file_name().to_str()?.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn all_pids() -> Vec<libc::pid_t> {
    Vec::new()
}
