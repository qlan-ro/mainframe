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

pub async fn poll_until(
    timeout: Duration,
    interval: Duration,
    mut condition: impl AsyncFnMut() -> bool,
) -> Result<(), tokio::time::error::Elapsed> {
    tokio::time::timeout(timeout, async {
        while !condition().await {
            tokio::time::sleep(interval).await;
        }
    })
    .await
}

#[cfg(test)]
mod poll_tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn poll_stops_when_the_condition_becomes_true() {
        let mut attempts = 0;
        poll_until(
            Duration::from_secs(1),
            Duration::from_millis(5),
            async || {
                attempts += 1;
                attempts == 3
            },
        )
        .await
        .unwrap();
        assert_eq!(attempts, 3);
    }

    #[tokio::test(start_paused = true)]
    async fn poll_fails_when_the_condition_never_becomes_true() {
        assert!(
            poll_until(
                Duration::from_millis(20),
                Duration::from_millis(5),
                async || false
            )
            .await
            .is_err()
        );
    }
}
