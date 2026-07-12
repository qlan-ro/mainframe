//! Ported from `packages/core/src/cli/status.ts` — `mainframe status`.
//!
//! Prints the running daemon's health (status/version/port/tunnel/data dir) and
//! the list of paired devices.

use serde_json::Value;

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
            eprintln!("Cannot reach daemon at {base_url}. Is it running?");
            std::process::exit(1);
        }
    };

    let status = health.get("status").and_then(Value::as_str).unwrap_or("?");
    let version = health
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let tunnel = health
        .get("tunnelUrl")
        .and_then(Value::as_str)
        .unwrap_or("not active");

    println!("\n  Mainframe Daemon");
    println!("  Status:     {status}");
    println!("  Version:    {version}");
    println!("  Port:       {}", config.port);
    println!("  Tunnel:     {tunnel}");
    println!("  Data dir:   {}", config.data_dir);

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
            if devices.is_empty() {
                println!("\n  Paired devices: none");
            } else {
                println!("\n  Paired devices:");
                for d in &devices {
                    let name = d.get("deviceName").and_then(Value::as_str).unwrap_or("?");
                    let id = d.get("deviceId").and_then(Value::as_str).unwrap_or("?");
                    let seen = d.get("lastSeen").and_then(Value::as_str).unwrap_or("never");
                    println!("    - {name} ({id}) — last seen: {seen}");
                }
            }
        }
        Err(_) => println!("\n  Could not fetch device list."),
    }

    println!();
    std::process::exit(0);
}

// PORT STATUS: src/cli/status.ts (46 lines)
// confidence: high
// notes: reqwest GET /health + /api/auth/devices against the loopback daemon.
// `lastSeen` is printed verbatim (the TS `new Date(...).toLocaleString()` is locale-
// dependent; the ISO string is the faithful, deterministic rendering here).
