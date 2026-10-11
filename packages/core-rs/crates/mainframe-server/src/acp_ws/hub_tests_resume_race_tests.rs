//! Seed-and-replay cases for `FacadeHub::reset_session`: what a resume
//! replaces, what it deltas against afterwards, and what it must not
//! resurrect. The buffering window itself lives in `awaiting_seed_tests.rs`.

include!("hub_tests_resume_race_tests_part_1.rs");
include!("hub_tests_resume_race_tests_part_2.rs");
