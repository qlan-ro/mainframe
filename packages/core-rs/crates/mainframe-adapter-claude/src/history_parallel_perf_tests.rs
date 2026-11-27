use super::history_worker::load_with_reader;
use super::parallel::ParseMode;
use super::parallel_fixture::{SESSION, assistant, tool_result, tool_use, user_text};
use super::*;
use serde_json::json;
use std::io::Read;

/// Timing and memory comparison on a generated ~150 MB transcript. Run with
/// `cargo test --release -p mainframe-adapter-claude --lib parse_speedup -- --ignored --nocapture`.
/// Set `PARSE_MODE=serial|parallel` to run a single mode, e.g. under
/// `/usr/bin/time -l` to read peak resident memory.
#[tokio::test]
#[ignore = "generates ~150 MB; run on demand"]
async fn parse_speedup_on_large_transcript() {
    let target: usize = std::env::var("PARSE_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(150)
        << 20;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.jsonl");
    write_large(&path, target);
    let size = std::fs::metadata(&path).unwrap().len();
    let path = path.to_str().unwrap().to_owned();
    let files = DiscoveredFiles {
        primary_path: path.clone(),
        all_files: vec![path],
        subagent_files: Default::default(),
        complete: false,
    };
    let run = |mode: ParseMode| {
        let files = DiscoveredFiles {
            primary_path: files.primary_path.clone(),
            all_files: files.all_files.clone(),
            subagent_files: Default::default(),
            complete: false,
        };
        async move {
            let start = std::time::Instant::now();
            let (rows, _) =
                load_with_reader(SESSION, &files, "/base", true, mode, reader::open_reader)
                    .await
                    .unwrap();
            (start.elapsed(), serde_json::to_string(&rows).unwrap())
        }
    };
    let detected = ParseMode::detect();
    if std::env::var("PARSE_MODE").as_deref() == Ok("parse-only") {
        for mode in [ParseMode::serial(), detected, ParseMode::serial(), detected] {
            let start = std::time::Instant::now();
            let reader = reader::open_reader(&files.primary_path).unwrap();
            let mut count = 0usize;
            super::parallel::read_parsed(reader, mode, |_, v| count += usize::from(v.is_some()))
                .unwrap();
            println!(
                "parse only x{}: {:.0} ms ({count} lines)",
                mode.threads,
                start.elapsed().as_secs_f64() * 1e3
            );
        }
        return;
    }
    if std::env::var("PARSE_MODE").as_deref() == Ok("read-only") {
        for _ in 0..3 {
            let start = std::time::Instant::now();
            let mut reader = reader::open_reader(&files.primary_path).unwrap();
            let mut buf = Vec::new();
            let mut total = 0;
            loop {
                buf.clear();
                let n = (&mut reader).take(8 << 20).read_to_end(&mut buf).unwrap();
                total += n;
                if n < 8 << 20 {
                    break;
                }
            }
            println!(
                "read only: {:.0} ms ({total} bytes)",
                start.elapsed().as_secs_f64() * 1e3
            );
        }
        return;
    }
    match std::env::var("PARSE_MODE").as_deref() {
        Ok("serial") => {
            let (t, _) = run(ParseMode::serial()).await;
            println!("serial {:.0} ms ({} MB)", t.as_secs_f64() * 1e3, size >> 20);
        }
        Ok("parallel") => {
            let (t, _) = run(detected).await;
            println!(
                "parallel x{} {:.0} ms ({} MB)",
                detected.threads,
                t.as_secs_f64() * 1e3,
                size >> 20
            );
        }
        _ => {
            let (_, _) = run(ParseMode::serial()).await; // warm the page cache
            let (serial, a) = run(ParseMode::serial()).await;
            let (parallel, b) = run(detected).await;
            assert_eq!(
                a, b,
                "parallel items differ from serial on the large transcript"
            );
            println!(
                "{} MB: serial {:.0} ms, parallel x{} {:.0} ms, speedup {:.2}x",
                size >> 20,
                serial.as_secs_f64() * 1e3,
                detected.threads,
                parallel.as_secs_f64() * 1e3,
                serial.as_secs_f64() / parallel.as_secs_f64()
            );
        }
    }
}

fn write_large(path: &Path, target: usize) {
    use std::io::Write;
    let mut out = std::io::BufWriter::new(std::fs::File::create(path).unwrap());
    let (mut written, mut n) = (0usize, 0usize);
    while written < target {
        n += 1;
        let id = format!("toolu_{n}");
        // Mostly large tool results (as in real sessions), some prose and noise.
        let blob = "lorem ipsum dolor sit amet \\n ".repeat(1 + (n * 37) % 600);
        let lines = [
            user_text(
                n * 4,
                &format!("prompt {n} {}", "word ".repeat(20)),
                json!({}),
            ),
            tool_use(n * 4 + 1, &id, "Bash"),
            tool_result(n * 4 + 2, &id, json!({"toolUseResult": {"stdout": blob}})),
            assistant(
                n * 4 + 3,
                &format!("text-{n}"),
                json!([{"type": "text", "text": "answer ".repeat(1 + n % 50)}]),
                json!({}),
            ),
        ];
        for line in lines {
            out.write_all(line.as_bytes()).unwrap();
            out.write_all(b"\n").unwrap();
            written += line.len() + 1;
        }
    }
    out.flush().unwrap();
}
