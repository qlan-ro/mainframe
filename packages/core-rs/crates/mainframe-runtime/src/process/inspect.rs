use super::run_captured;
use crate::ResolvedPath;
use std::time::Duration;
use tokio::process::Command;

async fn output(program: &str, args: &[&str], path: Option<&ResolvedPath>) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(path) = path {
        path.apply(&mut command);
    }
    let output = run_captured(command, Some(Duration::from_secs(5)))
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

pub async fn command_line(pid: u32, path: Option<&ResolvedPath>) -> Option<String> {
    process_field(pid, "command=", path).await
}

pub async fn command_name(pid: u32, path: Option<&ResolvedPath>) -> Option<String> {
    process_field(pid, "comm=", path).await
}

async fn process_field(pid: u32, field: &str, path: Option<&ResolvedPath>) -> Option<String> {
    let value = output("ps", &["-p", &pid.to_string(), "-o", field], path).await?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

pub async fn cwd(pid: u32, path: Option<&ResolvedPath>) -> Option<String> {
    let value = output(
        "lsof",
        &["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"],
        path,
    )
    .await?;
    let value = value
        .lines()
        .find_map(|line| line.strip_prefix('n'))?
        .trim();
    (!value.is_empty()).then(|| value.to_string())
}

pub async fn descendants(pid: u32, path: Option<&ResolvedPath>) -> Vec<u32> {
    let mut all = vec![pid];
    let mut index = 0;
    while index < all.len() {
        if let Some(value) = output("pgrep", &["-P", &all[index].to_string()], path).await {
            for child in value
                .split_whitespace()
                .filter_map(|v| v.parse::<u32>().ok())
            {
                if child > 0 && !all.contains(&child) {
                    all.push(child);
                }
            }
        }
        index += 1;
    }
    all.remove(0);
    all
}

pub fn parse_pids(stdout: &str, accept: impl Fn(&str) -> bool) -> Vec<u32> {
    let mut pids: Vec<u32> = Vec::new();
    let mut pending_pid: Option<u32> = None;
    for line in stdout.split('\n') {
        if line.is_empty() {
            continue;
        }
        let mut chars = line.chars();
        let tag = chars.next().unwrap_or('\0');
        let rest = &line[tag.len_utf8()..];
        if tag == 'p' {
            pending_pid = match rest.parse::<i64>() {
                Ok(n) if n > 0 => u32::try_from(n).ok(),
                _ => None,
            };
        } else if tag == 'a'
            && let Some(pid) = pending_pid
        {
            if accept(rest) {
                pids.push(pid);
            }
            pending_pid = None;
        }
    }
    pids
}

pub async fn writers_of(file: &str, path: &ResolvedPath) -> Result<Vec<u32>, super::ExecError> {
    let mut command = Command::new("lsof");
    command.args(["-F", "pan", "--", file]);
    path.apply(&mut command);
    let output = run_captured(command, Some(Duration::from_secs(2))).await?;
    if output.status.success() || output.status.code() == Some(1) {
        Ok(parse_pids(
            &String::from_utf8_lossy(&output.stdout),
            |mode| mode == "w" || mode == "u",
        ))
    } else {
        Err(std::io::Error::other(format!("lsof exited with {}", output.status)).into())
    }
}
