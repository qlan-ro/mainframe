//! Port target for `packages/core/src/messages/display-pipeline.ts` — NOT ported
//! into this crate.
//!
//! BLOCKER (crate layering): `prepareMessagesForClient` orchestrates the
//! Claude-specific `groupMessages` (message-grouping), `backfillTaskSubjects`
//! (task-subject-backfill), and the display-helpers converters. The crate map
//! §2.7 assigns message-grouping and task-subject-backfill to
//! `mainframe-adapter-claude`, which already depends on `mainframe-display`;
//! porting display-pipeline here would form a crate cycle. Per the §2.5 test it
//! references Claude shapes and belongs on the adapter-claude side. Recommended
//! resolution: reassign display-pipeline to `mainframe-adapter-claude::messages`
//! alongside display-helpers (the tool-grouping-askuserquestion
//! `prepareMessagesForClient` case ports with it).

// PORT STATUS: src/messages/display-pipeline.ts (152 lines) — NOT ported (blocker)
// confidence: n/a
// todos: 0
// notes: crate-layering blocker; must move to mainframe-adapter-claude. Left as an
// notes: empty module so the crate compiles without a cycle. See lib.rs trailer.
