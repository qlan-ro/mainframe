use super::fixture::*;
use super::*;
use crate::history::history_worker;
use crate::history::parallel_fixture::SESSION;
use mainframe_adapter_api::WindowRequest;

/// Time to a window of `turns` turns, read from the end or in full, on a
/// generated transcript; both must give the same window.
async fn time_to_window(
    megabytes: usize,
    turns: usize,
) -> (std::time::Duration, std::time::Duration) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.jsonl");
    let count = generate(&path, megabytes);
    let path = path.to_str().unwrap();
    let size = std::fs::metadata(path).unwrap().len();
    let files = discovered(path, &[]);
    let enough = move |messages: &[ChatMessage]| prompts(messages) >= turns;
    let request = || WindowRequest {
        turns: turns.max(16),
        enough: &enough,
    };
    // Warm the page cache; the first read of a fresh file is not what is compared.
    let _ = full_read(path).await;
    let started = std::time::Instant::now();
    let page = load_window(SESSION, &files, request())
        .await
        .unwrap()
        .expect("a window");
    let tail = started.elapsed();
    let started = std::time::Instant::now();
    let (rows, _) = history_worker::load_discovered_history(SESSION, &files, "/base", true)
        .await
        .unwrap();
    let full = started.elapsed();
    let start = window_start(&std::fs::read_to_string(path).unwrap(), &rows, turns);
    let from = page.messages.len() - (rows.len() - start);
    assert_eq!(json_of(&page.messages[from..]), json_of(&rows[start..]));
    println!(
        "{} MB, {count} turns: tail {:.1} ms ({} messages), full {:.1} ms ({} messages), {:.0}x",
        size >> 20,
        tail.as_secs_f64() * 1e3,
        page.messages.len(),
        full.as_secs_f64() * 1e3,
        rows.len(),
        full.as_secs_f64() / tail.as_secs_f64()
    );
    (tail, full)
}

#[tokio::test]
async fn the_tail_is_ready_sooner_than_the_full_read_on_a_generated_transcript() {
    let (tail, full) = time_to_window(24, 10).await;
    assert!(tail * 3 < full, "tail {tail:?} against full {full:?}");
}

/// Timing on a generated ~150 MB transcript. Run with
/// `cargo test --release -p mainframe-adapter-claude --lib window_on_150 -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "generates ~150 MB; run on demand"]
async fn window_on_150_mb_transcript() {
    for _ in 0..3 {
        let (tail, full) = time_to_window(150, 10).await;
        assert!(tail * 5 < full, "tail {tail:?} against full {full:?}");
    }
}
