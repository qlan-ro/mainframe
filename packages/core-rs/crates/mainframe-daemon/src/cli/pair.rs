//! Ported from `packages/core/src/cli/pair.ts` — `mainframe pair`.
//!
//! Requests a pairing code from the running daemon, prints it (with a QR code when
//! a tunnel is active), then polls `/api/auth/pair-status` until the device pairs
//! or the 5-minute code window elapses.

use std::time::Duration;

use qrcode::QrCode;
use qrcode::render::unicode;
use serde_json::{Value, json};

use super::connect_failure_message;

/// `runPair()`.
pub async fn run_pair() {
    let port = match mainframe_runtime::config::get_config() {
        Ok(config) => config.port,
        Err(err) => {
            eprintln!("Cannot read config: {err}");
            std::process::exit(1);
        }
    };
    let base_url = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();

    // Check the daemon is running + read the tunnel URL from /health.
    let health: Value = match client.get(format!("{base_url}/health")).send().await {
        Ok(res) => res.json().await.unwrap_or(Value::Null),
        Err(_) => {
            eprintln!("{}", connect_failure_message(&base_url));
            std::process::exit(1);
        }
    };

    // Request a pairing code.
    let pair_res = match client
        .post(format!("{base_url}/api/auth/pair"))
        .json(&json!({ "deviceName": "CLI pairing" }))
        .send()
        .await
    {
        Ok(res) => res,
        Err(err) => {
            eprintln!("Pairing failed: {err}");
            std::process::exit(1);
        }
    };
    if !pair_res.status().is_success() {
        let body: Value = pair_res.json().await.unwrap_or(Value::Null);
        let error = body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("request failed");
        eprintln!("Pairing failed: {error}");
        std::process::exit(1);
    }
    let pair_body: Value = pair_res.json().await.unwrap_or(Value::Null);
    let Some(pairing_code) = pair_body
        .get("data")
        .and_then(|d| d.get("pairingCode"))
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        eprintln!("Pairing failed: malformed response");
        std::process::exit(1);
    };
    let tunnel_url = health
        .get("tunnelUrl")
        .and_then(Value::as_str)
        .map(str::to_string);

    println!("{}", format_pairing_header(&pairing_code));

    if let Some(tunnel_url) = &tunnel_url {
        println!("  Enter this code in the Mainframe mobile app, or scan the QR code:\n");
        println!("{}", render_qr(&qr_payload_json(tunnel_url, &pairing_code)));
        println!("\n  Tunnel URL: {tunnel_url}");
    } else {
        println!("  Enter this code in the Mainframe mobile app.");
        println!("  No tunnel active — start daemon with TUNNEL=true for remote pairing.\n");
    }

    println!("  Waiting for device to pair...");

    // Poll every 2s until paired, up to the 5-minute code window.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5 * 60);
    loop {
        if tokio::time::Instant::now() >= deadline {
            println!("\n  Pairing code expired. Run `mainframe pair` to try again.\n");
            std::process::exit(1);
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        let url = format!(
            "{base_url}/api/auth/pair-status?code={}",
            urlencode(&pairing_code)
        );
        let Ok(res) = client.get(url).send().await else {
            continue; // transient network error — keep polling
        };
        let body: Value = res.json().await.unwrap_or(Value::Null);
        let data = body.get("data");
        if data
            .and_then(|d| d.get("paired"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let name = data
                .and_then(|d| d.get("deviceName"))
                .and_then(Value::as_str)
                .unwrap_or("device");
            let id = data
                .and_then(|d| d.get("deviceId"))
                .and_then(Value::as_str)
                .unwrap_or("?");
            println!("{}", format_device_paired(name, id));
            std::process::exit(0);
        }
    }
}

/// The pairing-code banner printed as soon as the daemon issues a code.
fn format_pairing_header(code: &str) -> String {
    format!("\n  Pairing code: {code}\n  Expires in 5 minutes\n")
}

/// The JSON payload encoded into the pairing QR code, matching the mobile
/// app's expected `{ url, code }` shape.
fn qr_payload_json(tunnel_url: &str, code: &str) -> String {
    json!({ "url": tunnel_url, "code": code }).to_string()
}

/// The success message printed once `/api/auth/pair-status` reports `paired`.
fn format_device_paired(name: &str, id: &str) -> String {
    format!("\n  Device paired: {name} ({id})\n")
}

/// Render `payload` as a compact terminal QR code (qrcode-terminal `small` mode).
fn render_qr(payload: &str) -> String {
    match QrCode::new(payload.as_bytes()) {
        Ok(code) => code.render::<unicode::Dense1x2>().quiet_zone(true).build(),
        Err(err) => format!("  (could not render QR code: {err})"),
    }
}

/// Minimal `encodeURIComponent` for the pairing code (alphanumerics survive; the
/// rest are percent-encoded). Pairing codes are short alphanumerics in practice.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

// PORT STATUS: src/cli/pair.ts (86 lines)
// confidence: medium
// notes: reqwest against the loopback daemon; qrcode-terminal small mode → the
// qrcode crate's Dense1x2 unicode renderer (cosmetic parity, not byte-exact). The
// setInterval(2s)/setTimeout(5min) poll becomes a sleep loop against a deadline;
// process::exit mirrors the TS exits. encodeURIComponent hand-rolled (no url crate).

#[cfg(test)]
mod tests;
