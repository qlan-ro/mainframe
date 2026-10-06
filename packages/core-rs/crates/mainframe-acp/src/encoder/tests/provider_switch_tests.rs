//! The provider-switch divider: its marker rides `ItemMeta.providerSwitch`,
//! and its label rides as a text block so clients without divider rendering
//! (mobile) still show a plain system marker.

use mainframe_types::display::{DisplayContent, DisplayMessageType, DisplayNode};
use mainframe_types::segment::{
    HandoffStatus, HandoffStrategy, HandoffSummary, ProviderSwitchMarker, SegmentKind,
    SegmentTotals,
};

use super::*;

fn marker() -> ProviderSwitchMarker {
    ProviderSwitchMarker {
        segment_id: "seg_1".to_string(),
        kind: SegmentKind::ProviderSwitch,
        from_adapter_id: "claude".to_string(),
        to_adapter_id: "codex".to_string(),
        from_adapter_name: "Claude".to_string(),
        to_adapter_name: "Codex".to_string(),
        to_model: None,
        resumed: false,
        previous: SegmentTotals::default(),
        handoff: Some(HandoffSummary {
            id: "ho_1".to_string(),
            strategy: HandoffStrategy::Full,
            status: HandoffStatus::Delivered,
            item_count: 4,
            omitted_count: 1,
            fell_back_to_fresh: false,
        }),
    }
}

#[test]
fn divider_carries_the_marker_meta_and_its_label_as_text() {
    let messages = vec![dmsg(
        "segdiv-seg_1",
        DisplayMessageType::System,
        vec![DisplayContent::Node(DisplayNode::ProviderSwitch {
            marker: marker(),
        })],
    )];
    let items = encode(&messages);
    assert_eq!(items.len(), 1);
    let EncodedItem::Message {
        id, content, meta, ..
    } = &items[0]
    else {
        panic!("the divider must encode as a message item");
    };
    assert_eq!(id, "segdiv-seg_1");
    assert_eq!(
        content,
        &vec![text_block(
            "Switched to Codex · context handed off (4 items, 1 omitted)"
        )]
    );
    let meta = meta.as_ref().expect("divider meta");
    let switch = &meta[MAINFRAME_META_NAMESPACE]["providerSwitch"];
    assert_eq!(switch["segmentId"], json!("seg_1"));
    assert_eq!(switch["toAdapterId"], json!("codex"));
    assert_eq!(switch["handoff"]["itemCount"], json!(4));
}
