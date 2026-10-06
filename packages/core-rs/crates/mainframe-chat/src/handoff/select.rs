//! Which whole items fit the budget. Priority: the last user message, the
//! last assistant message, the first user message, then newest to oldest.
//! Chosen items keep their original order; nothing is ever cut mid-item.

use super::items::{HandoffItem, ItemKind};
use super::render::render_item;

/// The separator between items (and before the user's message).
const SEPARATOR_BYTES: u64 = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct Selection {
    pub items: Vec<HandoffItem>,
    pub omitted: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeaderTooLarge;

pub fn item_cost(item: &HandoffItem) -> u64 {
    render_item(item).len() as u64 + SEPARATOR_BYTES
}

/// `header_cost(selected, omitted)` is the block's cost with no items; it is
/// charged once with the widest counters (`len`, `len`) so the real header
/// can never outgrow what was reserved for it.
pub fn select(
    items: &[HandoffItem],
    budget: u64,
    header_cost: impl Fn(usize, usize) -> u64,
) -> Result<Selection, HeaderTooLarge> {
    let header = header_cost(items.len(), items.len());
    let mut remaining = budget.checked_sub(header).ok_or(HeaderTooLarge)?;
    let mut chosen = vec![false; items.len()];
    let mut take = |i: usize, chosen: &mut Vec<bool>| {
        let cost = item_cost(&items[i]);
        if !chosen[i] && cost <= remaining {
            chosen[i] = true;
            remaining -= cost;
        }
    };
    let last_of = |kind: ItemKind| items.iter().rposition(|i| i.kind == kind);
    let first_user = items.iter().position(|i| i.kind == ItemKind::User);
    for index in [
        last_of(ItemKind::User),
        last_of(ItemKind::Assistant),
        first_user,
    ]
    .into_iter()
    .flatten()
    {
        take(index, &mut chosen);
    }
    for index in (0..items.len()).rev() {
        take(index, &mut chosen);
    }
    let picked: Vec<HandoffItem> = items
        .iter()
        .zip(&chosen)
        .filter(|(_, keep)| **keep)
        .map(|(item, _)| item.clone())
        .collect();
    Ok(Selection {
        omitted: items.len() - picked.len(),
        items: picked,
    })
}
