//! Basic fan-out, gate, and lifecycle characterization for `FacadeHub`.
//! Gate-lifecycle cases moved to `gate_tests.rs`, out-of-band notification
//! passthrough to `notification_tests.rs`, and resume/reset-session race cases
//! to `resume_race_tests.rs` — all three share this file's fixture builders via
//! `use super::*`.

include!("hub_tests_part_1.rs");
include!("hub_tests_part_2.rs");

#[path = "hub_tests_history.rs"]
mod history;
#[path = "hub_tests_turn_start.rs"]
mod turn_start_tests;
