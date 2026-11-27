use super::*;

fn batch() -> BatchFrame {
    BatchFrame {
        count: 3,
        bytes: vec![0x78, 0x01, 0xAA, 0xBB],
    }
}

#[test]
fn a_frame_round_trips_its_header_and_payload() {
    let frame = encode_frame("17", 1, 4, &batch()).unwrap();
    assert_eq!(
        decode_frame(&frame),
        Some(DecodedFrame {
            id: "17",
            index: 1,
            total: 4,
            count: 3,
            payload: &[0x78, 0x01, 0xAA, 0xBB],
        })
    );
}

#[test]
fn the_wire_layout_is_pinned_by_the_golden_fixture() {
    let fixture = include_str!("../../mainframe-types/tests/fixtures/acp/binary-frame.golden.hex");
    let expected: Vec<u8> = fixture
        .split_whitespace()
        .map(|byte| u8::from_str_radix(byte, 16).unwrap())
        .collect();
    assert_eq!(encode_frame("17", 1, 4, &batch()).unwrap(), expected);
}

#[test]
fn string_ids_travel_as_their_text() {
    assert_eq!(id_text(&RequestId::Number(42)), "42");
    assert_eq!(id_text(&RequestId::String("abc".into())), "abc");
    let frame = encode_frame("abc", 0, 1, &batch()).unwrap();
    assert_eq!(decode_frame(&frame).unwrap().id, "abc");
}

#[test]
fn short_unknown_version_and_overlong_id_frames_do_not_decode() {
    let good = encode_frame("17", 0, 1, &batch()).unwrap();
    assert_eq!(decode_frame(&good[..9]), None);
    let mut other = good.clone();
    other[0] = 2;
    assert_eq!(decode_frame(&other), None);
    let mut lying = good;
    lying[9] = 200; // id length beyond the frame
    assert_eq!(decode_frame(&lying), None);
}

#[test]
fn a_field_that_does_not_fit_the_header_is_refused() {
    assert!(encode_frame("1", 70_000, 70_001, &batch()).is_none());
    assert!(encode_frame(&"x".repeat(70_000), 0, 1, &batch()).is_none());
}
