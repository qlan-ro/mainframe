use mainframe_acp::encoder::EncodedItem;
use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use serde_json::{Value, json};

pub const OBSERVED_AT: u64 = 1_790_000_000_000;

fn meta_mut(item: &mut EncodedItem) -> &mut Option<Value> {
    match item {
        EncodedItem::Message { meta, .. }
        | EncodedItem::Thought { meta, .. }
        | EncodedItem::ToolCall { meta, .. } => meta,
    }
}

pub fn normalize(mut item: EncodedItem) -> EncodedItem {
    if let Some(ns) = meta_mut(&mut item)
        .as_mut()
        .and_then(|meta| meta.get_mut(MAINFRAME_META_NAMESPACE))
        .and_then(Value::as_object_mut)
    {
        ns.remove("timestamp");
    }
    item
}

pub fn assert_and_remove_live_timing(live: &mut [EncodedItem], cold: &[EncodedItem]) {
    let mut timed_ids = Vec::new();
    for item in live {
        let EncodedItem::ToolCall { id, meta, .. } = item else {
            continue;
        };
        let ns = meta.as_mut().unwrap()[MAINFRAME_META_NAMESPACE]
            .as_object_mut()
            .unwrap();
        assert_eq!(
            ns.remove("toolCallTiming"),
            Some(json!({ "startedAt": OBSERVED_AT, "completedAt": OBSERVED_AT })),
            "live call {id} must retain its observed start and completion"
        );
        timed_ids.push(id.as_str());
    }
    assert_eq!(
        timed_ids,
        [
            "toolu_01GbbKirv6FFfrAFLGXPje9V",
            "toolu_01WDu7EhjnvvkaK4K9kb5DQs"
        ],
        "both fixture calls must be timed"
    );
    for item in cold {
        let meta = match item {
            EncodedItem::Message { meta, .. }
            | EncodedItem::Thought { meta, .. }
            | EncodedItem::ToolCall { meta, .. } => meta,
        };
        assert!(
            meta.as_ref()
                .and_then(|meta| meta.get(MAINFRAME_META_NAMESPACE))
                .and_then(|ns| ns.get("toolCallTiming"))
                .is_none(),
            "provider history must not invent daemon observation timing"
        );
    }
}
