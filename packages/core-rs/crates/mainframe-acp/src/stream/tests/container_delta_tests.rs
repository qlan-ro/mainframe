//! `SessionStream::on_revision_delta` equivalence (todo #376 G2 task 5):
//! for an equivalent sequence of container snapshots, it must produce the
//! same frames `on_revision` would, frame for frame. Shares `stream/
//! tests.rs`'s fixture builders via `use super::*`.

use crate::encoder::delta::EncodedDelta;

use super::*;

fn flatten(containers: &[Vec<EncodedItem>]) -> Vec<EncodedItem> {
    containers.iter().flatten().cloned().collect()
}

#[test]
fn a_streaming_text_growth_matches_on_revision_frame_for_frame() {
    let before = vec![vec![message("m1", "Look")]];
    let after = vec![vec![message("m1", "Looking into it")]];

    let mut reference = stream();
    reference.on_revision(&flatten(&before), 0, None);
    let expected = reference.on_revision(&flatten(&after), 0, None);

    let mut actual = stream();
    actual.on_revision_delta(&EncodedDelta::full(before), || unreachable!(), 0, None);
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, after[0].clone())],
        len: 1,
    };
    let got = actual.on_revision_delta(&delta, || unreachable!(), 0, None);

    assert_eq!(got, expected);
}

#[test]
fn a_tool_result_landing_on_a_settled_container_matches_on_revision() {
    let before = vec![
        vec![message("m1", "hi")],
        vec![tool("t1", ToolCallStatus::InProgress)],
    ];
    let after = vec![
        vec![message("m1", "hi")],
        vec![tool("t1", ToolCallStatus::Completed)],
    ];

    let mut reference = stream();
    reference.on_revision(&flatten(&before), 0, None);
    let expected = reference.on_revision(&flatten(&after), 0, None);

    let mut actual = stream();
    actual.on_revision_delta(&EncodedDelta::full(before), || unreachable!(), 0, None);
    let delta = EncodedDelta {
        full: false,
        changes: vec![(1, after[1].clone())],
        len: 2,
    };
    let got = actual.on_revision_delta(&delta, || unreachable!(), 0, None);

    assert_eq!(got, expected);
}

#[test]
fn a_retry_marker_rides_a_container_delta_the_same_as_on_revision() {
    let before = vec![vec![message("m1", "A")]];
    let after = vec![vec![message("m1", "A, retrying")]];

    let mut reference = stream();
    reference.on_revision(&flatten(&before), 0, None);
    reference.on_retry(marker());
    let expected = reference.on_revision(&flatten(&after), 0, None);

    let mut actual = stream();
    actual.on_revision_delta(&EncodedDelta::full(before), || unreachable!(), 0, None);
    actual.on_retry(marker());
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, after[0].clone())],
        len: 1,
    };
    let got = actual.on_revision_delta(&delta, || unreachable!(), 0, None);

    assert_eq!(got, expected);
}

#[test]
fn seed_containers_then_on_revision_delta_produces_a_pure_delta_like_seed_and_on_revision() {
    let mut reference = stream();
    reference.seed(&[message("m1", "Hello")]);
    let expected = reference.on_revision(&[message("m1", "Hello world")], 0, None);

    let mut actual = stream();
    actual.seed_containers(&[vec![message("m1", "Hello")]]);
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, vec![message("m1", "Hello world")])],
        len: 1,
    };
    let got = actual.on_revision_delta(&delta, || unreachable!(), 0, None);

    assert_eq!(got, expected);
}

#[test]
fn an_unseeded_stream_given_an_incremental_delta_falls_back_to_full() {
    let containers = vec![vec![message("m1", "hi")], vec![message("m2", "there")]];

    let mut reference = stream();
    let expected = reference.on_revision(&flatten(&containers), 0, None);

    let mut actual = stream();
    let delta = EncodedDelta {
        full: false,
        changes: vec![(0, containers[0].clone())],
        len: containers.len(),
    };
    let containers_for_full = containers.clone();
    let got = actual.on_revision_delta(&delta, move || containers_for_full, 0, None);

    assert_eq!(got, expected);
}
