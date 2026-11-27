//! Peak memory of a background history refresh on a large synthetic history.
//! Ignored by default (it allocates hundreds of MB); run it with
//! `MF_HISTORY_MB=150 cargo test -p mainframe-chat refresh_peak_memory -- --ignored --nocapture`.
use super::*;
use serde_json::json;
use std::sync::atomic::AtomicBool;

fn current_rss_kb() -> u64 {
    std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

/// `megabytes` of generated assistant text, in 32 KB messages.
fn synthetic_history(megabytes: usize) -> Vec<ChatMessage> {
    let block = "synthetic filler text ".repeat(32 * 1024 / 22);
    (0..megabytes * 32)
        .map(|index| {
            serde_json::from_value(json!({"id":format!("m{index}"),"chatId":"c1",
                "type":"assistant","timestamp":"2026-10-02T00:00:00Z",
                "content":[{"type":"text","text":format!("{index} {block}")}]}))
            .unwrap()
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "allocates hundreds of MB; run on demand"]
async fn refresh_peak_memory() {
    let megabytes: usize = std::env::var("MF_HISTORY_MB")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(150);
    let dir = tempfile::tempdir().unwrap();
    let transcript = dir.path().join("session.jsonl");
    tokio::fs::write(&transcript, "{\"line\":1}\n").await.unwrap();
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some("session".into());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.history.lock().unwrap() = Some(synthetic_history(megabytes));
    *deps.adapters.transcript_present.lock().unwrap() = Some(true);
    deps.set_history_sources(vec![transcript]);
    deps.set_history_cache_dir(&dir.path().join("cache").to_string_lossy());
    let manager = ChatManager::new(deps);

    let baseline = current_rss_kb();
    let peak = Arc::new(std::sync::atomic::AtomicU64::new(baseline));
    let stop = Arc::new(AtomicBool::new(false));
    let sampler = {
        let (peak, stop) = (peak.clone(), stop.clone());
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_millis(5));
            while !stop.load(Ordering::Relaxed) {
                tick.tick().await;
                peak.fetch_max(current_rss_kb(), Ordering::Relaxed);
            }
        })
    };
    let refreshed = manager.refresh_history_cache("c1").await.unwrap();
    let count = refreshed.messages.len();
    drop(refreshed);
    stop.store(true, Ordering::Relaxed);
    sampler.await.unwrap();
    let peak = peak.load(Ordering::Relaxed);
    let bytes = std::fs::metadata(dir.path().join("cache/c1.json")).unwrap().len();
    println!(
        "history {megabytes} MB, {count} messages, snapshot {} MB: baseline {} MB, peak {} MB, refresh added {} MB",
        bytes / 1_048_576,
        baseline / 1024,
        peak / 1024,
        (peak - baseline) / 1024
    );
    manager.dispose();
}
