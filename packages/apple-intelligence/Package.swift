// swift-tools-version: 6.2
import PackageDescription

// Apple's on-device model (FoundationModels) is Swift-only and has no C ABI, so the
// Rust daemon reaches it through this executable rather than through FFI. It is
// bundled as a second Tauri sidecar next to `mainframe-daemon`.
let package = Package(
    name: "mainframe-intelligence",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "mainframe-intelligence", targets: ["MainframeIntelligence"])
    ],
    targets: [
        .executableTarget(name: "MainframeIntelligence", path: "Sources/MainframeIntelligence")
    ]
)
