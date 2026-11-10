use super::*;

pub(super) fn idle_marker(
    metadata: &mainframe_types::compaction::CompactionMetadata,
    container: &Container<'_>,
    out: &mut Vec<EncodedItem>,
) {
    let id = metadata
        .vendor_id
        .clone()
        .unwrap_or_else(|| metadata.request_id.clone());
    out.push(EncodedItem::Message {
        id: id.clone(),
        role: ItemRole::Agent,
        content: Vec::new(),
        meta: wrap_meta(ItemMeta {
            container_id: Some(id),
            kind: Some(ItemContainerKind::System),
            is_compacted: Some(true),
            compaction: Some(metadata.clone()),
            actionable: Some(false),
            message_meta: None,
            ..container.base_meta()
        }),
    });
}
