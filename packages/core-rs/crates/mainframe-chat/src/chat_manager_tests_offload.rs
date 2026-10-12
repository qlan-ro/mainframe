//! Idle whole-chat offload, AC1-7: a real `ChatManager` wires the
//! real `ChatOffload` end to end via `scan_idle_sessions` (which builds one
//! from the manager's own shared state, matching production wiring), so these
//! tests exercise the same registry/cache/event path production code takes.
//!
//! No fake clock is needed: a `FakeSession.activity` this suite sets once, at
//! construction, several hours in the PAST relative to the real wall clock,
//! is idle past the real 2-hour `IDLE_THRESHOLD_MS` for the lifetime of the
//! test — there is no reason to inject time.

include!("chat_manager_tests_offload_part_1.rs");
include!("chat_manager_tests_offload_part_2.rs");
include!("chat_manager_tests_offload_part_3.rs");
include!("chat_manager_tests_offload_part_4.rs");
