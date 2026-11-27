use super::fixture::*;
use super::*;
use crate::history::parallel_fixture::SESSION;
use serde_json::json;

/// `turns` prompts, each followed by `pad` bytes of one record the loader skips.
fn padded(turns: usize, pad: usize) -> String {
    let mut build = Builder::default();
    for turn in 0..turns {
        build.user(&format!("question {turn}"));
        build.raw(
            &json!({"type": "progress", "uuid": format!("pad{turn}"),
            "sessionId": SESSION, "pad": "x".repeat(pad)})
            .to_string(),
        );
    }
    build.text()
}

#[tokio::test]
async fn a_window_the_first_read_projects_past_the_cap_stops_after_that_read() {
    // 1 MiB a turn: the first 2 MiB hold about two prompts, so eleven turns
    // would need 11 MiB or more, past a third of this 24 MiB file.
    let file = write(&padded(24, 1 << 20));
    let limits = Limits {
        first_read: 2 << 20,
        min_file: 0,
    };
    let mut held = Held::default();
    let found = read_tail(&file.path, SESSION, &HashSet::new(), 10, limits, &mut held).unwrap();
    assert!(found.is_none());
    assert_eq!(held.bytes.len(), 2 << 20, "no second read was made");
}

#[tokio::test]
async fn a_longer_attempt_reuses_the_bytes_the_last_one_read() {
    let file = write(&Builder::default().turns(40).text());
    let mut held = Held::default();
    let first = read_tail(
        &file.path,
        SESSION,
        &HashSet::new(),
        2,
        small(700),
        &mut held,
    )
    .unwrap();
    let held_before = held.bytes.len();
    assert!(first.is_some());
    // Overwrite what is held on disk: only a read from the file would notice.
    let length = std::fs::metadata(&file.path).unwrap().len();
    let mut bytes = std::fs::read(&file.path).unwrap();
    for byte in &mut bytes[(length - held_before as u64) as usize..] {
        *byte = b'x';
    }
    std::fs::write(&file.path, bytes).unwrap();
    let again = read_tail(
        &file.path,
        SESSION,
        &HashSet::new(),
        2,
        small(700),
        &mut held,
    )
    .unwrap();
    assert_eq!(json_of(&again.unwrap()), json_of(&first.unwrap()));
    assert_eq!(held.bytes.len(), held_before, "nothing more was read");
}

#[tokio::test]
async fn a_window_that_fits_the_cap_grows_to_it_when_doubling_would_pass_it() {
    // 10 MB file, so a 4 MiB cap; the first 3 MiB project 3.6 MB for the window,
    // and twice 3 MiB is past the cap.
    let file = write(&padded(100, 100_000));
    let limits = Limits {
        first_read: 3 << 20,
        min_file: 0,
    };
    let found = read_tail(
        &file.path,
        SESSION,
        &HashSet::new(),
        35,
        limits,
        &mut Held::default(),
    )
    .unwrap();
    assert!(found.is_some());
}
