use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

pub fn write_shell_script(path: &Path, body: &str) -> io::Result<()> {
    let body = body.strip_prefix("#!/bin/sh\n").unwrap_or(body);
    std::fs::write(
        path,
        format!("#!/bin/sh\n[ \"$1\" = --mf-exec-probe ] && exit 0\n{body}"),
    )?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match std::process::Command::new(path)
            .arg("--mf-exec-probe")
            .status()
        {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                return Err(io::Error::other(format!(
                    "script probe exited with {status}"
                )));
            }
            Err(error)
                if error.kind() == io::ErrorKind::ExecutableFileBusy
                    && Instant::now() < deadline =>
            {
                // A concurrently forked child must exec and release its inherited writer.
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(error) => return Err(error),
        }
    }
}
