//! Ported from `packages/core/src/cli/status.ts` — `mainframe status`.
//!
//! Prints the running daemon's health (status/version/port/tunnel/data dir) and
//! the list of paired devices.

use serde_json::Value;

use super::connect_failure_message;

/// `runStatus()`.
pub async fn run_status() {
    let config = match mainframe_runtime::config::get_config() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("Cannot read config: {err}");
            std::process::exit(1);
        }
    };
    let base_url = format!("http://127.0.0.1:{}", config.port);
    let client = reqwest::Client::new();

    let health: Value = match client.get(format!("{base_url}/health")).send().await {
        Ok(res) => res.json().await.unwrap_or(Value::Null),
        Err(_) => {
            eprintln!("{}", connect_failure_message(&base_url));
            std::process::exit(1);
        }
    };

    println!(
        "{}",
        format_status_report(&health, config.port, &config.data_dir)
    );

    match client
        .get(format!("{base_url}/api/auth/devices"))
        .send()
        .await
    {
        Ok(res) => {
            let body: Value = res.json().await.unwrap_or(Value::Null);
            let devices = body
                .get("data")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            println!("{}", format_devices(&devices));
        }
        Err(_) => println!("\n  Could not fetch device list."),
    }

    println!();
    std::process::exit(0);
}

/// `runStatus()`'s health block — the `Mainframe Daemon` status/version/port/
/// tunnel/data-dir summary printed above the device list.
fn format_status_report(health: &Value, port: u16, data_dir: &str) -> String {
    let status = health.get("status").and_then(Value::as_str).unwrap_or("?");
    let version = health
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let tunnel = health
        .get("tunnelUrl")
        .and_then(Value::as_str)
        .unwrap_or("not active");

    format!(
        "\n  Mainframe Daemon\n  Status:     {status}\n  Version:    {version}\n  Port:       {port}\n  Tunnel:     {tunnel}\n  Data dir:   {data_dir}"
    )
}

/// `runStatus()`'s paired-device list, printed after the health block.
fn format_devices(devices: &[Value]) -> String {
    if devices.is_empty() {
        return "\n  Paired devices: none".to_string();
    }
    let mut lines = vec!["\n  Paired devices:".to_string()];
    for d in devices {
        let name = d.get("deviceName").and_then(Value::as_str).unwrap_or("?");
        let id = d.get("deviceId").and_then(Value::as_str).unwrap_or("?");
        let seen = d.get("lastSeen").and_then(Value::as_str).unwrap_or("never");
        lines.push(format!("    - {name} ({id}) — last seen: {seen}"));
    }
    lines.join("\n")
}

// PORT STATUS: src/cli/status.ts (46 lines)
// confidence: high
// notes: reqwest GET /health + /api/auth/devices against the loopback daemon.
// `lastSeen` is printed verbatim (the TS `new Date(...).toLocaleString()` is locale-
// dependent; the ISO string is the faithful, deterministic rendering here).

#[cfg(test)]
mod tests;
