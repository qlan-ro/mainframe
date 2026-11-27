use super::budget::Budget;
use super::parallel::{ParseMode, read_parsed};
use super::parallel_fixture::{leaked_budget, synthetic};
use std::io::{BufReader, Cursor};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicUsize, Ordering};

fn mode(budget: &'static Budget, threads: usize) -> ParseMode {
    ParseMode {
        threads,
        batch_bytes: 2048,
        min_parallel_bytes: 0,
        budget,
        size_hint: None,
        probe: None,
    }
}

fn lines(mode: ParseMode, bytes: &[u8]) -> Vec<String> {
    let mut seen = Vec::new();
    read_parsed(BufReader::new(Cursor::new(bytes.to_vec())), mode, |l, _| {
        seen.push(l.to_owned());
    })
    .unwrap();
    seen
}

fn serial_lines(bytes: &[u8]) -> Vec<String> {
    lines(mode(leaked_budget(1), 1), bytes)
}

#[test]
fn the_permit_caps_the_threads_a_load_uses() {
    static PIECES: AtomicUsize = AtomicUsize::new(0);
    let bytes = synthetic(40);
    let budget = leaked_budget(2);
    let capped = ParseMode {
        probe: Some(&PIECES),
        ..mode(budget, 8)
    };
    assert_eq!(lines(capped, &bytes), serial_lines(&bytes));
    assert_eq!(
        PIECES.load(Ordering::Relaxed),
        2,
        "a budget of 2 must split batches into 2 pieces, not 8"
    );
    assert_eq!(budget.free(), 2);
}

#[test]
fn concurrent_loads_share_the_budget_and_return_it() {
    let bytes = synthetic(40);
    let expected = serial_lines(&bytes);
    let budget = leaked_budget(6);
    std::thread::scope(|scope| {
        for _ in 0..10 {
            scope.spawn(|| {
                for _ in 0..5 {
                    assert_eq!(lines(mode(budget, 4), &bytes), expected);
                }
            });
        }
    });
    assert!(budget.peak(6) >= 2, "no load ran in parallel");
    assert_eq!(budget.free(), 6, "workers leaked");
}

#[test]
fn an_exhausted_budget_falls_back_to_serial() {
    let bytes = synthetic(10);
    let budget = leaked_budget(3);
    let held = budget.take(3);
    assert_eq!(held.workers(), 3);
    assert_eq!(lines(mode(budget, 4), &bytes), serial_lines(&bytes));
    assert_eq!(budget.free(), 0);
    drop(held);
    assert_eq!(budget.free(), 3);
    // One free worker is not worth a thread: the load stays serial and keeps none.
    let one = leaked_budget(1);
    assert_eq!(lines(mode(one, 4), &bytes), serial_lines(&bytes));
    assert_eq!(one.free(), 1);
}

#[test]
fn small_files_take_no_workers() {
    static PIECES: AtomicUsize = AtomicUsize::new(0);
    let bytes = synthetic(40);
    let budget = leaked_budget(4);
    let held = budget.take(4);
    let small = ParseMode {
        size_hint: Some(10),
        min_parallel_bytes: 1024,
        probe: Some(&PIECES),
        ..mode(budget, 4)
    };
    assert_eq!(lines(small, &bytes), serial_lines(&bytes));
    assert_eq!(PIECES.load(Ordering::Relaxed), 0);
    drop(held);
}

#[test]
fn workers_return_after_an_error() {
    struct Fails;
    impl std::io::Read for Fails {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("injected"))
        }
    }
    let budget = leaked_budget(4);
    let result = read_parsed(BufReader::new(Fails), mode(budget, 4), |_, _| {});
    assert!(result.is_err());
    assert_eq!(budget.free(), 4);
}

#[test]
fn workers_return_after_a_panic() {
    let bytes = synthetic(40);
    let budget = leaked_budget(4);
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let _ = read_parsed(
            BufReader::new(Cursor::new(bytes.clone())),
            mode(budget, 4),
            |_, _| panic!("visitor failed"),
        );
    }));
    assert!(outcome.is_err());
    assert_eq!(budget.free(), 4);
}

#[test]
fn a_background_load_holds_at_most_its_cap_and_a_foreground_load_gets_the_rest() {
    static BACKGROUND: AtomicUsize = AtomicUsize::new(0);
    static FOREGROUND: AtomicUsize = AtomicUsize::new(0);
    let bytes = synthetic(40);
    let budget = leaked_budget(8);
    let background = ParseMode {
        probe: Some(&BACKGROUND),
        ..mode(budget, 8)
    }
    .background();
    let foreground = ParseMode {
        probe: Some(&FOREGROUND),
        ..mode(budget, 8)
    };
    let mut free_meanwhile = None;
    let mut seen = Vec::new();
    // The foreground load runs while the background one still holds its permit.
    read_parsed(
        BufReader::new(Cursor::new(bytes.clone())),
        background,
        |line, _| {
            seen.push(line.to_owned());
            if free_meanwhile.is_none() {
                free_meanwhile = Some(budget.free());
                assert_eq!(lines(foreground, &bytes), serial_lines(&bytes));
            }
        },
    )
    .unwrap();
    assert_eq!(seen, serial_lines(&bytes));
    assert_eq!(free_meanwhile, Some(6), "the background load holds 2 of 8");
    assert_eq!(BACKGROUND.load(Ordering::Relaxed), 2);
    assert_eq!(
        FOREGROUND.load(Ordering::Relaxed),
        6,
        "the foreground load gets the other 6, not serial"
    );
    assert_eq!(budget.peak(8), 8);
    assert_eq!(budget.free(), 8);
}

#[test]
fn background_mode_never_raises_a_smaller_mode() {
    assert_eq!(ParseMode::serial().background().threads, 1);
    assert_eq!(mode(leaked_budget(8), 8).background().threads, 2);
}
