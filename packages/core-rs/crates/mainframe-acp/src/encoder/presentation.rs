use super::*;
use mainframe_types::transcript_presentation::*;

pub(super) type SourceMap = HashMap<Vec<usize>, Option<PresentationSourceIdentity>>;

pub(super) fn read_sources(message: &DisplayMessage) -> SourceMap {
    let sources = message
        .metadata
        .as_ref()
        .and_then(|m| m.get(PRESENTATION_SOURCES_KEY))
        .and_then(DisplayPresentationSources::from_value)
        .map(|s| s.sources)
        .unwrap_or_default();
    let mut map = SourceMap::new();
    for source in sources {
        map.entry(source.path)
            .and_modify(|entry| *entry = None)
            .or_insert(Some(source.identity));
    }
    map
}

pub(super) fn legacy_meta(meta: Option<&HashMap<String, Value>>) -> Option<HashMap<String, Value>> {
    meta.map(|m| {
        m.iter()
            .filter(|(key, _)| {
                !matches!(
                    key.as_str(),
                    PRESENTATION_SOURCES_KEY | PRESENTATION_CONTEXT_KEY | "presentationStreaming"
                )
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    })
    .filter(|m: &HashMap<String, Value>| !m.is_empty() || meta.is_some_and(HashMap::is_empty))
}

pub(super) fn source(container: &Container<'_>) -> Option<PresentationSourceIdentity> {
    container
        .presentation_sources
        .get(&container.path)
        .and_then(Clone::clone)
        .filter(|identity| {
            identity.presentation.parent_tool_use_id.as_deref() == container.parent_tool_call_id
        })
}

pub(super) fn whole(container: &Container<'_>) -> Option<PresentationSources> {
    source(container).map(|identity| PresentationSources {
        version: 1,
        sources: vec![PresentationSource {
            identity,
            target: PresentationTarget::Block {
                content_block_index: 0,
            },
        }],
    })
}

pub(super) fn push_leaf(accum: &mut accum::Accum, leaf: &LeafContent, container: &Container<'_>) {
    let Some(identity) = source(container) else {
        return;
    };
    let target = match leaf {
        LeafContent::Text { text, .. } | LeafContent::Thinking { thinking: text, .. } => {
            let (index, start) = match accum.blocks.last() {
                Some(ContentBlock::Text { text, .. }) => (accum.blocks.len() - 1, utf16_len(text)),
                _ => (accum.blocks.len(), 0),
            };
            PresentationTarget::Text {
                content_block_index: index,
                start_utf16: start,
                end_utf16: start + utf16_len(text),
            }
        }
        LeafContent::Image { .. } => PresentationTarget::Block {
            content_block_index: accum.blocks.len(),
        },
        _ => return,
    };
    accum
        .presentation_sources
        .push(PresentationSource { identity, target });
}
