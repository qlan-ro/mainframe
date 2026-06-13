use std::io::Read;
use std::sync::mpsc::Sender;

/// Runs the reader loop for a PTY master clone.
///
/// Called in a dedicated `std::thread::spawn` closure. It NEVER locks the
/// session map (C3): it owns only the cloned reader, the two callbacks, and
/// a `reap_tx` to notify the manager that this session has self-exited.
///
/// When the cloned reader hits EOF (slave fd closed — either via `child.kill()`
/// or the child exiting naturally), `on_exit` is called with `None` (we cannot
/// read the precise exit code without locking the map, which is forbidden), then
/// the id is sent on `reap_tx` so the manager can remove the dead entry.
pub fn run_reader_loop<D, E>(
    mut reader: Box<dyn Read + Send>,
    id: String,
    reap_tx: Sender<String>,
    on_data: D,
    on_exit: E,
) where
    D: Fn(Vec<u8>) + Send + 'static,
    E: Fn(Option<i32>) + Send + 'static,
{
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,     // EOF: slave fd closed
            Ok(n) => on_data(buf[..n].to_vec()),
            Err(_) => break,    // read error — treat as EOF
        }
    }
    on_exit(None);
    let _ = reap_tx.send(id);
}
