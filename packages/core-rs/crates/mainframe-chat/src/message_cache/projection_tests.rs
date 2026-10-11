//! Journal coverage: every `MessageCache` mutation
//! records the entry the plan's table assigns it, and every removal path
//! drops the slot so the next projection rebuilds from scratch (`Full`).
//! A fake projector that records its own `ProjectionInput` is used instead
//! of a real `prepare`, so these tests pin the journal/slot contract in
//! isolation from grouping behavior.

include!("projection_tests_part_1.rs");
include!("projection_tests_part_2.rs");
