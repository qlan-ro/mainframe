//! What a `session/resume` whose spawned delivery never returned owes the
//! client: a settled promise and a way back onto the stream.

include!("resume_tests_part_1.rs");
include!("resume_tests_part_2.rs");

#[path = "resume_tests_deferred_seed.rs"]
mod deferred_seed;

#[path = "resume_tests_loaded_tail.rs"]
mod loaded_tail;
