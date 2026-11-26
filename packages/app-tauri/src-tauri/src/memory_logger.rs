use serde::Serialize;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[cfg(target_os = "macos")]
mod macos;

#[derive(Serialize)]
struct ProcessMemory {
    pid: u32,
    rss_bytes: u64,
    footprint_bytes: Option<u64>,
}

#[derive(Serialize)]
struct WebKitProcess {
    service: &'static str,
    #[serde(flatten)]
    memory: ProcessMemory,
}

#[derive(Serialize)]
struct Snapshot {
    host: ProcessMemory,
    daemon: Option<ProcessMemory>,
    webkit: Vec<WebKitProcess>,
    webkit_rss_bytes: u64,
    webkit_footprint_bytes: Option<u64>,
    webkit_footprint_processes: usize,
}

impl Snapshot {
    fn new(
        host: ProcessMemory,
        daemon: Option<ProcessMemory>,
        mut webkit: Vec<WebKitProcess>,
    ) -> Self {
        webkit.sort_unstable_by_key(|process| process.memory.pid);
        let webkit_rss_bytes = webkit.iter().map(|p| p.memory.rss_bytes).sum();
        let footprints = webkit.iter().filter_map(|p| p.memory.footprint_bytes);
        let webkit_footprint_processes = footprints.clone().count();
        let webkit_footprint_bytes = (webkit_footprint_processes > 0).then(|| footprints.sum());
        Self {
            host,
            daemon,
            webkit,
            webkit_rss_bytes,
            webkit_footprint_bytes,
            webkit_footprint_processes,
        }
    }
}

fn webkit_service(name: &str) -> Option<&'static str> {
    let service = name.strip_prefix("com.apple.WebKit.")?;
    match service.split('.').next()? {
        "WebContent" => Some("WebContent"),
        "GPU" => Some("GPU"),
        "Networking" => Some("Networking"),
        _ => None,
    }
}

fn belongs_to_host(
    host: Pid,
    host_coalition: Option<u64>,
    mut parent: Option<Pid>,
    parent_of: impl Fn(Pid) -> Option<Pid>,
    process_coalition: impl FnOnce() -> Option<u64>,
) -> bool {
    // A racing process-table snapshot can contain a PID reuse cycle.
    for _ in 0..64 {
        match parent {
            Some(pid) if pid == host => return true,
            Some(pid) => parent = parent_of(pid),
            None => break,
        }
    }
    host_coalition.is_some_and(|id| process_coalition() == Some(id))
}

fn sample(daemon: Option<Pid>) -> Option<Snapshot> {
    let host = sysinfo::get_current_pid().ok()?;
    let mut system = System::new();
    let processes = if cfg!(target_os = "macos") {
        ProcessesToUpdate::All
    } else {
        ProcessesToUpdate::Some(std::slice::from_ref(&host))
    };
    system.refresh_processes_specifics(
        processes,
        ProcessRefreshKind::new()
            .with_memory()
            .with_exe(UpdateKind::OnlyIfNotSet),
    );
    if let Some(pid) = daemon.filter(|_| !cfg!(target_os = "macos")) {
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            ProcessRefreshKind::new().with_memory(),
        );
    }
    let read = |pid| {
        let process = system.process(pid)?;
        Some(ProcessMemory {
            pid: process.pid().as_u32(),
            rss_bytes: process.memory(),
            footprint_bytes: footprint(pid),
        })
    };
    let host_coalition = coalition(host).filter(|id| {
        let parent = system.process(host).and_then(sysinfo::Process::parent);
        parent
            .and_then(coalition)
            .is_some_and(|parent_id| parent_id != *id)
    });
    let webkit = system
        .processes()
        .values()
        .filter_map(|process| {
            let basename = process.exe().and_then(std::path::Path::file_name);
            let service = webkit_service(basename.unwrap_or(process.name()).to_str()?)?;
            belongs_to_host(
                host,
                host_coalition,
                process.parent(),
                |pid| system.process(pid).and_then(sysinfo::Process::parent),
                || coalition(process.pid()),
            )
            .then(|| read(process.pid()).map(|memory| WebKitProcess { service, memory }))
            .flatten()
        })
        .collect();
    Some(Snapshot::new(read(host)?, daemon.and_then(read), webkit))
}

#[cfg(target_os = "macos")]
use macos::{coalition, footprint};

#[cfg(not(target_os = "macos"))]
fn footprint(_: Pid) -> Option<u64> {
    None
}

#[cfg(not(target_os = "macos"))]
fn coalition(_: Pid) -> Option<u64> {
    None
}

pub fn start_memory_logger() {
    if let Err(error) = std::thread::Builder::new()
        .name("memory-logger".into())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_secs(5 * 60));
            let daemon = crate::DAEMON
                .get()
                .and_then(crate::sidecar::DaemonHandle::pid);
            if let Some(data) = sample(daemon.map(Pid::from_u32))
                .and_then(|snapshot| serde_json::to_value(snapshot).ok())
            {
                crate::log_sink::emit_event(
                    "info",
                    "host:perf",
                    "host memory snapshot",
                    Some(&data),
                );
            } else {
                tracing::warn!(module = "host:perf", "memory sample unavailable");
            }
        })
    {
        tracing::warn!(%error, "failed to start memory sampling");
    }
}

#[cfg(test)]
mod tests;
