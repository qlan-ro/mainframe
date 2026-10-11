//! The resolver is a fake pointing at a real `cat` child (reads stdin, echoes
//! stdout, stays alive until SIGTERM) standing in for a long-lived server. Idle
//! and shutdown timers are shrunk via `set_test_timeouts` so the suite runs in
//! real time.

include!("lsp_manager_tests_part_1.rs");
include!("lsp_manager_tests_part_2.rs");
