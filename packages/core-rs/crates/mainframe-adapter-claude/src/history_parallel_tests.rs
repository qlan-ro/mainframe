use super::history_worker::load_with_reader;
use super::parallel::ParseMode;
use super::parallel_fixture::{SESSION, leaked_budget, synthetic};
use super::*;
use std::io::{self, BufReader, Cursor, Read};

async fn load(bytes: Vec<u8>, mode: ParseMode) -> (String, String) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.jsonl");
    std::fs::write(&path, &bytes).unwrap();
    let path = path.to_str().unwrap().to_owned();
    let files = DiscoveredFiles {
        primary_path: path.clone(),
        all_files: vec![path],
        subagent_files: Default::default(),
        complete: false,
    };
    let (rows, carried) = load_with_reader(SESSION, &files, "/base", true, mode, |p| {
        reader::open_reader(p)
    })
    .await
    .unwrap();
    (
        serde_json::to_string(&rows).unwrap(),
        format!("{:?}", (carried.plans, carried.skill_names)),
    )
}

fn tiny(threads: usize, batch_bytes: usize) -> ParseMode {
    ParseMode {
        threads,
        batch_bytes,
        min_parallel_bytes: 0,
        budget: leaked_budget(threads),
        size_hint: None,
        probe: None,
    }
}

#[tokio::test]
async fn parallel_matches_serial_across_batch_shapes() {
    for gap in [0, 3, 40] {
        let bytes = synthetic(gap);
        let expected = load(bytes.clone(), ParseMode::serial()).await;
        assert!(
            expected.0.contains("toolu_agent"),
            "fixture lost its agent call"
        );
        assert!(expected.1.contains("plans/a.md") && expected.1.contains("review"));
        for threads in [2, 3, 8] {
            for batch in [64, 700, 4096, 65_536, 10_000_000] {
                let actual = load(bytes.clone(), tiny(threads, batch)).await;
                assert_eq!(
                    actual, expected,
                    "gap {gap}, {threads} threads, batch {batch}"
                );
            }
        }
        let detected = ParseMode {
            budget: leaked_budget(8),
            ..ParseMode::detect()
        };
        assert_eq!(load(bytes, detected).await, expected);
    }
}

#[tokio::test]
async fn tool_results_join_across_chunks() {
    let bytes = synthetic(40);
    let (rows, _) = load(bytes, tiny(4, 2048)).await;
    let rows: Vec<Value> = serde_json::from_str(&rows).unwrap();
    let result_ids: Vec<&str> = rows
        .iter()
        .flat_map(|row| row["content"].as_array().into_iter().flatten())
        .filter(|node| node["type"] == "tool_result")
        .filter_map(|node| node["toolUseId"].as_str())
        .collect();
    assert!(result_ids.contains(&"toolu_0") && result_ids.contains(&"toolu_11"));
}

#[tokio::test]
async fn invalid_utf8_ends_the_read_in_both_modes() {
    let mut bytes = synthetic(3);
    let at = bytes.len() / 2;
    let cut = bytes[at..].iter().position(|&b| b == b'\n').unwrap() + at + 1;
    bytes.splice(cut..cut, b"\xff\xfe broken\n".iter().copied());
    let expected = load(bytes.clone(), ParseMode::serial()).await;
    for batch in [64, 4096] {
        assert_eq!(load(bytes.clone(), tiny(4, batch)).await, expected);
    }
}

/// Hands out its bytes a few at a time, as a file does while it is written.
struct Drip {
    data: Vec<u8>,
    pos: usize,
    step: usize,
    fail_at: Option<usize>,
}

impl Read for Drip {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.fail_at.is_some_and(|at| self.pos >= at) {
            return Err(io::Error::other("injected"));
        }
        let n = out.len().min(self.step).min(self.data.len() - self.pos);
        out[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
        self.pos += n;
        Ok(n)
    }
}

async fn load_stream(
    make: impl Fn() -> Drip + Send + 'static,
    mode: ParseMode,
) -> (String, String) {
    let files = DiscoveredFiles {
        primary_path: "p".into(),
        all_files: vec!["p".into()],
        subagent_files: Default::default(),
        complete: false,
    };
    let (rows, carried) = load_with_reader(SESSION, &files, "/base", true, mode, move |_| {
        Ok(BufReader::with_capacity(97, make()))
    })
    .await
    .unwrap();
    (
        serde_json::to_string(&rows).unwrap(),
        format!("{:?}", (carried.plans, carried.skill_names)),
    )
}

#[tokio::test]
async fn file_growing_mid_line_matches_serial() {
    let bytes = synthetic(3);
    for step in [1, 7, 500] {
        let data = bytes.clone();
        let serial = {
            let data = data.clone();
            load_stream(
                move || Drip {
                    data: data.clone(),
                    pos: 0,
                    step,
                    fail_at: None,
                },
                ParseMode::serial(),
            )
            .await
        };
        for batch in [64, 3000] {
            let data = data.clone();
            let actual = load_stream(
                move || Drip {
                    data: data.clone(),
                    pos: 0,
                    step,
                    fail_at: None,
                },
                tiny(4, batch),
            )
            .await;
            assert_eq!(actual, serial, "step {step}, batch {batch}");
        }
    }
}

#[tokio::test]
async fn read_failure_keeps_complete_lines_in_both_modes() {
    let bytes = synthetic(3);
    for fail_at in [bytes.len() / 3, bytes.len() / 2 + 5] {
        let data = bytes.clone();
        let serial = {
            let data = data.clone();
            load_stream(
                move || Drip {
                    data: data.clone(),
                    pos: 0,
                    step: 50,
                    fail_at: Some(fail_at),
                },
                ParseMode::serial(),
            )
            .await
        };
        for batch in [64, 3000] {
            let data = data.clone();
            let actual = load_stream(
                move || Drip {
                    data: data.clone(),
                    pos: 0,
                    step: 50,
                    fail_at: Some(fail_at),
                },
                tiny(4, batch),
            )
            .await;
            assert_eq!(actual, serial, "fail_at {fail_at}, batch {batch}");
        }
    }
}

/// The load result hides read errors (`complete: false`), so check the
/// reader itself: both modes must report the failure after the same lines.
#[test]
fn read_failure_is_reported_by_both_modes() {
    let bytes = synthetic(3);
    for fail_at in [bytes.len() / 3, bytes.len() / 2 + 5] {
        let run = |mode| {
            let drip = Drip {
                data: bytes.clone(),
                pos: 0,
                step: 50,
                fail_at: Some(fail_at),
            };
            let mut seen = Vec::new();
            let result = super::parallel::read_parsed(
                BufReader::with_capacity(97, drip),
                mode,
                |line, _| seen.push(line.to_owned()),
            );
            (result.is_err(), seen)
        };
        let (serial_failed, serial) = run(ParseMode::serial());
        assert!(serial_failed && !serial.is_empty());
        for batch in [64, 3000] {
            let (failed, seen) = run(tiny(4, batch));
            assert!(failed, "parallel read lost the error, batch {batch}");
            assert_eq!(seen, serial, "fail_at {fail_at}, batch {batch}");
        }
    }
}

#[test]
fn empty_and_newline_only_inputs_match() {
    for bytes in [&b""[..], b"\n", b"\n\n\n", b"{}", b"{}\r\n{}\r", b"\r\n"] {
        let collect = |mode| {
            let mut seen = Vec::new();
            super::parallel::read_parsed(Cursor::new(bytes.to_vec()), mode, |line, v| {
                seen.push((line.to_owned(), v));
            })
            .unwrap();
            seen
        };
        assert_eq!(collect(ParseMode::serial()), collect(tiny(3, 2)));
    }
}
