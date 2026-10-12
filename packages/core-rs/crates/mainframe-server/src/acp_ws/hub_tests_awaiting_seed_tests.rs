//! The `AwaitingSeed` window: everything raised between `begin_resume` and the
//! snapshot's arrival is buffered, then drained behind the replay — a revision
//! as a diff against the seed, raw frames in arrival order, minus the one gate
//! the replay redelivers itself.

include!("hub_tests_awaiting_seed_tests_part_1.rs");
include!("hub_tests_awaiting_seed_tests_part_2.rs");
