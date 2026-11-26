use super::*;

#[test]
fn webkit_attribution_requires_ancestry_or_app_coalition() {
    let host = Pid::from_u32(42);
    let helper = Pid::from_u32(50);
    let launchd = Pid::from_u32(1);
    let parent_of = |pid| (pid == helper).then_some(host);
    assert!(belongs_to_host(host, None, Some(helper), parent_of, || {
        None
    }));
    assert!(belongs_to_host(
        host,
        Some(8),
        Some(launchd),
        parent_of,
        || Some(8)
    ));
    assert!(!belongs_to_host(
        host,
        Some(8),
        Some(launchd),
        parent_of,
        || Some(9)
    ));
    assert!(!belongs_to_host(
        host,
        None,
        Some(launchd),
        parent_of,
        || None
    ));
    assert_eq!(
        webkit_service("com.apple.WebKit.WebContent.Development"),
        Some("WebContent")
    );
    assert_eq!(webkit_service("com.apple.WebKit.GPU"), Some("GPU"));
    assert_eq!(
        webkit_service("com.apple.WebKit.Networking"),
        Some("Networking")
    );
    assert_eq!(webkit_service("com.apple.Safari"), None);
}

#[test]
fn structured_snapshot_distinguishes_missing_footprint_from_zero() {
    let memory = |pid, rss_bytes, footprint_bytes| ProcessMemory {
        pid,
        rss_bytes,
        footprint_bytes,
    };
    let snapshot = Snapshot::new(
        memory(42, 200, Some(72)),
        Some(memory(43, 100, Some(50))),
        vec![
            WebKitProcess {
                service: "GPU",
                memory: memory(45, 50, None),
            },
            WebKitProcess {
                service: "WebContent",
                memory: memory(44, 99, Some(80)),
            },
        ],
    );
    let data = serde_json::to_value(snapshot).unwrap();
    assert_eq!(data["host"]["rss_bytes"], 200);
    assert_eq!(data["daemon"]["footprint_bytes"], 50);
    assert_eq!(data["webkit_rss_bytes"], 149);
    assert_eq!(data["webkit_footprint_bytes"], 80);
    assert_eq!(data["webkit_footprint_processes"], 1);
    assert_eq!(data["webkit"][0]["service"], "WebContent");
    assert!(data["webkit"][1]["footprint_bytes"].is_null());
}

#[test]
fn host_memory_can_be_sampled_without_launching_the_app() {
    let host = sample(None).unwrap().host;
    assert!(host.rss_bytes > 0);
    #[cfg(target_os = "macos")]
    assert!(host.footprint_bytes.is_some_and(|bytes| bytes > 0));
}
