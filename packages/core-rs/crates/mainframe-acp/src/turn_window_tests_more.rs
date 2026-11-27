use super::*;

#[test]
fn a_window_starting_on_a_marker_drops_the_marker_with_its_turn() {
    let messages = vec![
        user("u1"),
        reply("a1"),
        marker("c1"),
        user("u2"),
        big("a2", "assistant", 5_000),
        user("u3"),
        reply("a3"),
    ];
    let index = TurnIndex::new(&messages);
    let w = wire(&messages);
    let all = encoded(&messages);
    // The marker, u2 and a2 are one turn: sent whole when nothing follows it.
    let mut containers = all[2..5].to_vec();
    assert_eq!(index.fit(2, &mut containers, &w, 1_000), 2);
    assert_eq!(containers.len(), 3);
    // With a newer turn behind it, that turn goes whole, marker included.
    let mut containers = all[2..].to_vec();
    let marker_bytes = w.bytes(2, &all[2]);
    let total: usize = (2..7).map(|i| w.bytes(i, &all[i])).sum();
    assert_eq!(
        index.fit(2, &mut containers, &w, total - marker_bytes / 2),
        5
    );
    assert_eq!(containers.len(), 2);
}

#[test]
fn lazy_images_are_only_discounted_when_the_client_opted_in() {
    let item = tool_call_with_image("t", 400_000, 100);
    let lazy = Wire::new(false, true, 1).bytes(0, std::slice::from_ref(&item));
    let full = Wire::new(false, false, 1).bytes(0, std::slice::from_ref(&item));
    assert!(lazy < 1_000 && full > 400_000, "{lazy} {full}");
}
