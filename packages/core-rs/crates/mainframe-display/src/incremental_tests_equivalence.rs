//! Equivalence suite: after every step, the projector's snapshot and the
//! delta-replayed mirror must equal a fresh `prepare_messages_for_client` call.
//! `Harness::step` asserts this on every call, so each scenario below is really
//! just "drive this sequence without panicking".

include!("incremental_tests_equivalence_part_1.rs");
include!("incremental_tests_equivalence_part_2.rs");
