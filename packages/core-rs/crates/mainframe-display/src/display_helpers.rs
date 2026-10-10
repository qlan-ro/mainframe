//! Port target for `packages/core/src/messages/display-helpers.ts` — NOT ported
//! into this crate.
//!
//! BLOCKER (crate layering): display-helpers imports Claude-specific parsers —
//! `stripMainframeCommandTags`, `parseCommandMessage`, `parseAttachedFilePathTags`
//! (message-parsing), `GroupedMessage` (message-grouping), and
//! `parseAskUserQuestionResult` (parse-ask-user-question). The crate map §2.7
//! assigns all three of those source files to `mainframe-adapter-claude`, which
//! already depends on `mainframe-display`. Porting display-helpers here would
//! require `mainframe-display → mainframe-adapter-claude`, a crate cycle Cargo
//! forbids. The file also fails the §2.5 test ("references Claude shapes → the
//! adapter crate"). Recommended resolution: reassign display-helpers to
//! `mainframe-adapter-claude::messages` (its grouping tests —
//! apply-tool-grouping-characterization, display-helpers-*) go with it. The
//! adapter-agnostic pieces it uses (tool_grouping, tool_categorization,
//! truncate_tool_content) are fully ported here.
