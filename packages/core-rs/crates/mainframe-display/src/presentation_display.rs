use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayContent, DisplayNode};
use mainframe_types::transcript_presentation::{
    DisplayPresentationSource, PresentationSourceIdentity,
};
use std::collections::{HashMap, VecDeque};

// Grouping preserves leaf order within each parent; tool identity survives regrouping.
pub(super) fn regroup(
    before: &[DisplayContent],
    after: &[DisplayContent],
    sources: Vec<DisplayPresentationSource>,
) -> Vec<DisplayPresentationSource> {
    let mut leaves: HashMap<(Option<String>, u8), VecDeque<Vec<PresentationSourceIdentity>>> =
        HashMap::new();
    let mut tools = HashMap::new();
    let mut by_index: HashMap<Vec<usize>, Vec<PresentationSourceIdentity>> = HashMap::new();
    for source in sources {
        by_index
            .entry(source.path)
            .or_default()
            .push(source.identity);
    }
    for (index, block) in before.iter().enumerate() {
        let identity = by_index.remove(&vec![index]).unwrap_or_default();
        if let Some(key) = leaf_key(block) {
            leaves.entry(key).or_default().push_back(identity);
        } else if let DisplayContent::Node(DisplayNode::ToolCall { id, .. }) = block {
            tools.insert(id.clone(), identity);
        }
    }
    let mut output = Vec::new();
    walk(after, &[], &mut |block, path| {
        collect_progress(block, path, &mut tools, &mut output);
        let identities = if let Some(key) = leaf_key(block) {
            leaves
                .get_mut(&key)
                .and_then(VecDeque::pop_front)
                .unwrap_or_default()
        } else {
            tool_id(block)
                .and_then(|id| tools.remove(id))
                .unwrap_or_default()
        };
        output.extend(
            identities
                .into_iter()
                .map(|identity| DisplayPresentationSource {
                    identity,
                    path: path.to_vec(),
                }),
        );
    });
    output
}

fn leaf_key(block: &DisplayContent) -> Option<(Option<String>, u8)> {
    match block {
        DisplayContent::Leaf(LeafContent::Text {
            parent_tool_use_id, ..
        }) => Some((parent_tool_use_id.clone(), 0)),
        DisplayContent::Leaf(LeafContent::Thinking {
            parent_tool_use_id, ..
        }) => Some((parent_tool_use_id.clone(), 1)),
        DisplayContent::Leaf(LeafContent::Image {
            parent_tool_use_id, ..
        }) => Some((parent_tool_use_id.clone(), 2)),
        _ => None,
    }
}

fn tool_id(block: &DisplayContent) -> Option<&str> {
    match block {
        DisplayContent::Node(DisplayNode::ToolCall { id, .. }) => Some(id),
        DisplayContent::Node(DisplayNode::TaskGroup { agent_id, .. }) => Some(agent_id),
        _ => None,
    }
}

fn walk(
    blocks: &[DisplayContent],
    parent: &[usize],
    visit: &mut impl FnMut(&DisplayContent, &[usize]),
) {
    for (index, block) in blocks.iter().enumerate() {
        let mut path = parent.to_vec();
        path.push(index);
        visit(block, &path);
        if let DisplayContent::Node(
            DisplayNode::TaskGroup { calls, .. } | DisplayNode::ToolGroup { calls },
        ) = block
        {
            walk(calls, &path, visit);
        }
    }
}

fn collect_progress(
    block: &DisplayContent,
    path: &[usize],
    tools: &mut HashMap<String, Vec<PresentationSourceIdentity>>,
    output: &mut Vec<DisplayPresentationSource>,
) {
    if let DisplayContent::Node(DisplayNode::TaskProgress { items }) = block {
        for (index, item) in items.iter().enumerate() {
            let mut child_path = path.to_vec();
            child_path.push(index);
            output.extend(
                tools
                    .remove(&item.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|identity| DisplayPresentationSource {
                        identity,
                        path: child_path.clone(),
                    }),
            );
        }
    }
}
