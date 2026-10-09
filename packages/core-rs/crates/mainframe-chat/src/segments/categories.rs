//! Tool categories for a chat that spans several adapters: display folding
//! must classify every segment's tools, so the chat gets the union of the
//! categories of each adapter its segments ran on.

use mainframe_types::display::ToolCategories;

/// The adapters a chat's segments ran on, each once, in first-use order,
/// starting with `active` (the chat's current adapter).
pub fn segment_adapters(
    active: &str,
    layout: Option<&mainframe_types::segment::SegmentLayout>,
) -> Vec<String> {
    let mut adapters = vec![active.to_string()];
    for native in layout.map(|l| l.natives.as_slice()).unwrap_or_default() {
        if !adapters.contains(&native.adapter_id) {
            adapters.push(native.adapter_id.clone());
        }
    }
    adapters
}

/// The union of every adapter's categories; `None` when no adapter has any.
pub fn union_categories(all: impl IntoIterator<Item = ToolCategories>) -> Option<ToolCategories> {
    all.into_iter().reduce(|mut acc, next| {
        acc.explore.extend(next.explore);
        acc.hidden.extend(next.hidden);
        acc.progress.extend(next.progress);
        acc.subagent.extend(next.subagent);
        acc
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use mainframe_types::segment::{NativeSessionRecord, SegmentLayout};

    use super::*;

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn categories(explore: &[&str], subagent: &[&str]) -> ToolCategories {
        ToolCategories {
            explore: set(explore),
            hidden: HashSet::new(),
            progress: HashSet::new(),
            subagent: set(subagent),
        }
    }

    #[test]
    fn the_union_keeps_every_adapter_category() {
        let claude = categories(&["Read", "Grep"], &["Task"]);
        let codex = categories(&[], &["CollabAgent"]);
        let union = union_categories([claude, codex]).unwrap();
        assert_eq!(union.explore, set(&["Read", "Grep"]));
        assert_eq!(union.subagent, set(&["Task", "CollabAgent"]));
        assert!(union_categories(Vec::new()).is_none());
    }

    #[test]
    fn segment_adapters_start_with_the_active_one_and_dedupe() {
        let native = |adapter: &str| NativeSessionRecord {
            adapter_id: adapter.into(),
            ..Default::default()
        };
        let layout = SegmentLayout {
            natives: vec![native("claude"), native("codex"), native("claude")],
            ..Default::default()
        };
        assert_eq!(
            segment_adapters("codex", Some(&layout)),
            ["codex", "claude"]
        );
        assert_eq!(segment_adapters("claude", None), ["claude"]);
    }
}
