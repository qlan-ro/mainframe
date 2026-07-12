//! Six-fixture conformance suite (plan T10.2) + durability/cancel matrix
//! (T10.3). Each `§12` reference automation is driven end-to-end through the
//! real `AutomationsEngine` facade with recording fakes; assertions target the
//! behaviors the plan names per fixture. One integration target keeps the
//! harness compiled once; the scenario modules live under `conformance/`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "conformance/fakes.rs"]
mod fakes;

#[path = "conformance/fake_actions.rs"]
mod fake_actions;

#[path = "conformance/harness.rs"]
mod harness;

#[path = "conformance/health_log.rs"]
mod health_log;

#[path = "conformance/standup.rs"]
mod standup;

#[path = "conformance/pr_review.rs"]
mod pr_review;

#[path = "conformance/pr_sweep.rs"]
mod pr_sweep;

#[path = "conformance/ship_work.rs"]
mod ship_work;

#[path = "conformance/feature_spike.rs"]
mod feature_spike;

#[path = "conformance/restart.rs"]
mod restart;

#[path = "conformance/cancel.rs"]
mod cancel;
