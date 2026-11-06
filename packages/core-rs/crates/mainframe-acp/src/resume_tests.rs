include!("resume_tests_part_1.rs");
include!("resume_tests_part_2.rs");

#[path = "resume_tests_windowed.rs"]
mod windowed;

#[path = "resume_tests_persisted.rs"]
mod persisted;

#[path = "resume_tests_turn_start.rs"]
mod turn_start;
