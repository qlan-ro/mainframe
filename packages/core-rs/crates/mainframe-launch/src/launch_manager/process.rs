use super::*;

pub(super) fn pump_output<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    reader: R,
    inner: Arc<Inner>,
    name: String,
    stream: LaunchStream,
    stderr_tail: Option<Arc<Mutex<TailBuffer>>>,
) -> tokio::task::JoinHandle<()> {
    mainframe_runtime::process::spawn_chunk_pump(reader, move |bytes| {
        let data = String::from_utf8_lossy(bytes).into_owned();
        inner.state.buffer_output(&name, stream, &data);
        if let Some(tail) = &stderr_tail {
            let mut tail = tail.lock_recover();
            for line in data.split('\n').filter(|line| !line.trim().is_empty()) {
                tail.push(line.to_string());
            }
        }
        inner.emit_output(&name, data, stream);
        true
    })
}

/// Everything the exit watcher needs to retire one launch process.
pub(super) struct ExitWatch {
    pub(super) inner: Arc<Inner>,
    pub(super) name: String,
    pub(super) pid: Option<u32>,
    pub(super) status: Arc<Mutex<LaunchProcessStatus>>,
    pub(super) stderr_tail: Arc<Mutex<TailBuffer>>,
    pub(super) exit_tx: watch::Sender<bool>,
}

/// Reap the child, then retire it in two steps: the process entry is removed
/// and the exit published as soon as the pid is reaped, so a concurrent
/// `stop()` never signals a reaped (possibly reused) pid while the output
/// pumps finish; the final status is emitted only after the pumps delivered
/// their last chunk.
pub(super) async fn wait_for_exit_task(
    mut child: tokio::process::Child,
    watch: ExitWatch,
    pumps: Vec<tokio::task::JoinHandle<()>>,
) {
    let ExitWatch {
        inner,
        name,
        pid,
        status,
        stderr_tail,
        exit_tx,
    } = watch;
    let code = child.wait().await.ok().and_then(|s| s.code());
    inner.processes.remove(&name);
    inner.forget_spawn(pid);
    let _ = exit_tx.send(true); /* expected: no stop() is waiting */

    mainframe_runtime::process::finish_pumps(pumps).await;

    log_exit(&name, pid, code, &stderr_tail);

    {
        let mut guard = status.lock_recover();
        if *guard != LaunchProcessStatus::Stopped {
            *guard = if code == Some(0) {
                LaunchProcessStatus::Stopped
            } else {
                LaunchProcessStatus::Failed
            };
            inner.state.set_status(&name, *guard);
            inner.emit_status(&name, *guard);
        }
    }

    if let Some(tm) = &inner.tunnel_manager {
        tm.stop(&format!("preview:{name}")).await;
    }
}

/// Poll `localhost:port` until it accepts a TCP connection or the process
/// exits/stops. Returns `true` if it timed out. Readiness is a TCP connect, not
/// an HTTP probe.
pub(super) async fn wait_for_port(
    port: u16,
    status: &Arc<Mutex<LaunchProcessStatus>>,
    timings: &LaunchTimings,
) -> bool {
    let start = Instant::now();
    loop {
        {
            let current = *status.lock_recover();
            if current == LaunchProcessStatus::Stopped || current == LaunchProcessStatus::Failed {
                return false;
            }
        }
        if start.elapsed() > timings.port_timeout {
            tracing::warn!(target: "launch", port, "port readiness timeout, proceeding anyway");
            return true;
        }
        if let Ok(Ok(_stream)) = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(("localhost", port)),
        )
        .await
        {
            return false;
        }
        sleep(timings.port_poll).await;
    }
}

pub(super) async fn wait_until_exited(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
}

/// Signal a launch child's whole process group (pnpm/tsx spawn child trees),
/// falling back to the pid alone when the group cannot be signalled.
pub(super) fn signal_group(pid: Option<u32>, kind: Signal) {
    use mainframe_runtime::process::{Target, signal};
    let Some(pid) = pid else { return };
    if !matches!(signal(Target::Group(pid), kind), Ok(true))
        && let Err(error) = signal(Target::Pid(pid), kind)
    {
        tracing::warn!(pid, %error, "failed to signal launch child");
    }
}

fn log_exit(name: &str, pid: Option<u32>, code: Option<i32>, stderr_tail: &Arc<Mutex<TailBuffer>>) {
    {
        let tail = stderr_tail.lock_recover();
        if code != Some(0) && !tail.is_empty() {
            tracing::warn!(
                target: "launch",
                name = %name,
                pid = ?pid,
                code = ?code,
                stderr = %tail.iter().cloned().collect::<Vec<_>>().join("\n"),
                "launch process failed"
            );
        } else {
            tracing::info!(target: "launch", name = %name, pid = ?pid, code = ?code, "launch process exited");
        }
    }
}
