//! Ordinal bookkeeping and snapshot sync once a call's groups
//! have settled: groups below the rewind point keep their ordinal (nothing
//! about their presence changed), the newly folded tail gets numbered
//! continuing from there, and the materialized snapshot list is patched to
//! match without re-cloning untouched entries.

use mainframe_display::DisplaySnapshot;

use super::group::Group;

/// Number every group from `from` onward, continuing the ordinal sequence
/// found by scanning backward from `from - 1` (bounded: the scan stops at
/// the first `Some`, which in the common case is immediate).
pub(crate) fn renumber_from(groups: &mut [Group], from: usize) {
    let mut next = groups[..from]
        .iter()
        .rev()
        .find_map(|g| g.ordinal)
        .map(|o| o + 1)
        .unwrap_or(0);
    for group in &mut groups[from..] {
        group.ordinal = group.display.as_ref().map(|_| {
            let ordinal = next;
            next += 1;
            ordinal
        });
    }
}

/// Total container count: one past the highest ordinal in use, or 0.
pub(crate) fn total_len(groups: &[Group]) -> usize {
    groups
        .iter()
        .rev()
        .find_map(|g| g.ordinal)
        .map(|o| o + 1)
        .unwrap_or(0)
}

/// Patch the materialized snapshot in place for every `(ordinal, display)`
/// pair, truncating to `len` first. Pairs must be in ascending ordinal order
/// with no gaps beyond the snapshot's current length (the fold invariant:
/// ordinals are assigned contiguously).
pub(crate) fn sync_snapshot(
    snapshot: &DisplaySnapshot,
    len: usize,
    changes: &[(usize, mainframe_types::display::DisplayMessage)],
) {
    snapshot.with_mut(|list| {
        if list.len() > len {
            list.truncate(len);
        }
        for (ordinal, display) in changes {
            if *ordinal < list.len() {
                list[*ordinal] = display.clone();
            } else {
                list.push(display.clone());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::display::{DisplayMessage, DisplayMessageType};

    fn group_with(ordinal: Option<usize>, has_display: bool) -> Group {
        Group {
            raw_range: 0..1,
            mergeable: false,
            display: has_display.then(|| DisplayMessage {
                id: "x".to_string(),
                chat_id: "c".to_string(),
                r#type: DisplayMessageType::User,
                content: Vec::new(),
                timestamp: "t".to_string(),
                metadata: None,
            }),
            ordinal,
            claimed_tool_ids: Vec::new(),
            duration_override: None,
        }
    }

    #[test]
    fn renumbers_continuing_from_the_frozen_prefix() {
        let mut groups = vec![
            group_with(Some(0), true),
            group_with(None, false),
            group_with(None, true),
            group_with(None, true),
        ];
        renumber_from(&mut groups, 1);
        assert_eq!(groups[1].ordinal, None);
        assert_eq!(groups[2].ordinal, Some(1));
        assert_eq!(groups[3].ordinal, Some(2));
        assert_eq!(total_len(&groups), 3);
    }

    #[test]
    fn renumbers_from_zero_when_the_prefix_is_empty() {
        let mut groups = vec![group_with(None, true), group_with(None, true)];
        renumber_from(&mut groups, 0);
        assert_eq!(groups[0].ordinal, Some(0));
        assert_eq!(groups[1].ordinal, Some(1));
    }
}
