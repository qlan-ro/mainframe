/// A dropped cursor must not have blocked the merge chain around it — chunks
/// on either side of it still coalesce as if it were never there.
#[test]
fn chunks_on_both_sides_of_a_dropped_cursor_still_coalesce() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    assert!(throttle.push(1_010, chunk("b")).is_empty());
    assert!(throttle.push_cursor(1_020, cursor(1)).is_empty());
    assert!(throttle.push(1_030, chunk("c")).is_empty());
    assert!(throttle.push_cursor(1_040, cursor(2)).is_empty());

    let out = throttle.push(1_060, chunk("d"));
    assert_eq!(
        out.len(),
        2,
        "the three chunks merge into one, plus the surviving cursor: {out:?}"
    );
    assert_eq!(chunk_text(&out[0]), "bcd");
    assert_eq!(out[1], ThrottledFrame::Cursor(cursor(2)));
}

/// The cursor rides after the content it describes (per the module doc):
/// even when it arrived mid-batch, it ends up last in the flushed frames.
#[test]
fn the_cursor_rides_after_every_content_frame_in_its_batch() {
    let mut throttle = Throttle::new(50);
    assert_eq!(throttle.push(1_000, chunk("a")).len(), 1);

    assert!(throttle.push_cursor(1_010, cursor(1)).is_empty());
    assert!(throttle.push(1_020, chunk("b")).is_empty());

    let out = throttle.push(1_060, chunk("c"));
    assert_eq!(out.len(), 2);
    assert_eq!(chunk_text(&out[0]), "bc");
    assert_eq!(out[1], ThrottledFrame::Cursor(cursor(1)));
}
