fn main() {
    // preview-bridge is inlined (src/preview/bridge_plugin.rs) so its commands
    // get build-time ACL permissions that capabilities/preview.json can grant
    // to remote-origin preview child webviews.
    tauri_build::try_build(tauri_build::Attributes::new().plugin(
        "preview-bridge",
        tauri_build::InlinedPlugin::new().commands(&[
            "inspect_result",
            "region_result",
            "navigate_event",
            "open_external",
        ]),
    ))
    .expect("failed to run tauri-build");
}
