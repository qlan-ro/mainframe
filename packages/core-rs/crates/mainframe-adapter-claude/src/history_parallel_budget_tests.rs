use super::budget::Budget;
use super::parallel::{ParseMode, read_parsed_in};
use super::parallel_fixture::synthetic;
use std::io::{BufReader, Cursor};
use std::panic::{AssertUnwindSafe, catch_unwind};

fn mode() -> ParseMode {
    ParseMode {
        threads: 4,
        batch_bytes: 2048,
        min_parallel_bytes: 0,
    }
}

fn lines(budget: &Budget, bytes: &[u8]) -> Vec<String> {
    let mut seen = Vec::new();
    read_parsed_in(
        budget,
        BufReader::new(Cursor::new(bytes.to_vec())),
        mode(),
        |l, _| {
            seen.push(l.to_owned());
        },
    )
    .unwrap();
    seen
}

#[test]
fn concurrent_loads_never_exceed_the_budget() {
    let bytes = synthetic(40);
    let expected = lines(&Budget::new(1), &bytes);
    let budget = Budget::new(6);
    std::thread::scope(|scope| {
        for _ in 0..10 {
            scope.spawn(|| {
                for _ in 0..5 {
                    assert_eq!(lines(&budget, &bytes), expected);
                }
            });
        }
    });
    assert!(budget.peak(6) <= 6, "peak {}", budget.peak(6));
    assert!(budget.peak(6) >= 2, "no load ran in parallel");
    assert_eq!(budget.free(), 6, "workers leaked");
}

#[test]
fn an_exhausted_budget_falls_back_to_serial() {
    let bytes = synthetic(10);
    let budget = Budget::new(3);
    let held = budget.take(3);
    assert_eq!(held.workers, 3);
    assert_eq!(lines(&budget, &bytes), lines(&Budget::new(1), &bytes));
    assert_eq!(budget.free(), 0);
    drop(held);
    assert_eq!(budget.free(), 3);
    // One free worker is not worth a thread: the load stays serial and returns it.
    let one = Budget::new(1);
    assert_eq!(lines(&one, &bytes), lines(&Budget::new(1), &bytes));
    assert_eq!(one.free(), 1);
}

#[test]
fn workers_return_after_an_error() {
    struct Fails;
    impl std::io::Read for Fails {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("injected"))
        }
    }
    let budget = Budget::new(4);
    let result = read_parsed_in(&budget, BufReader::new(Fails), mode(), |_, _| {});
    assert!(result.is_err());
    assert_eq!(budget.free(), 4);
}

#[test]
fn workers_return_after_a_panic() {
    let bytes = synthetic(40);
    let budget = Budget::new(4);
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let _ = read_parsed_in(
            &budget,
            BufReader::new(Cursor::new(bytes.clone())),
            mode(),
            |_, _| panic!("visitor failed"),
        );
    }));
    assert!(outcome.is_err());
    assert_eq!(budget.free(), 4);
}
