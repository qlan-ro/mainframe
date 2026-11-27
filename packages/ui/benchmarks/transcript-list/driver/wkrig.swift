// WKWebView harness for the transcript list rig, after the session-open benchmark's `wkbench.swift`.
// One 1280x720 web view (system WebKit, the engine Safari 27 and the app use) with a non-persistent
// store, in a plain window at the screen's bottom-left corner. Commands arrive on stdin as JSON lines:
//   {"cmd":"load","url":...}  {"cmd":"call","id":1,"js":"return await ..."}  {"cmd":"quit"}
// The page reaches native input through `window.__rigNative(command)`: `wheel` sends one pixel
// scroll-wheel NSEvent to the web view, `flick` a trackpad gesture with its momentum phase.
// It never launches or touches the Mainframe app, its web view storage, or the Keychain.
import AppKit
import WebKit

final class Bridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    var web: WKWebView!
    func out(_ object: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write((text + "\n").data(using: .utf8)!)
        }
    }

    func scroll(_ dy: Double, at point: NSPoint, phase: Int64 = 0, momentum: Int64 = 0) {
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(-dy), wheel2: 0, wheel3: 0) else { return }
        let screenHeight = NSScreen.screens.first?.frame.height ?? 0
        let inWindow = web.convert(point, to: nil)
        let onScreen = web.window!.convertPoint(toScreen: inWindow)
        event.location = CGPoint(x: onScreen.x, y: screenHeight - onScreen.y)
        event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        event.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: -dy)
        event.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: -dy)
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        event.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
        if let ns = NSEvent(cgEvent: event) { web.scrollWheel(with: ns) }
    }

    /// A flick: five finger frames (began, changed..., ended), then a decaying momentum tail.
    func flick(_ dy: Double, at point: NSPoint, done: @escaping () -> Void) {
        var steps: [(Double, Int64, Int64)] = [(0, 1, 0)]
        for _ in 0..<4 { steps.append((dy * 0.06, 2, 0)) }
        steps.append((0, 4, 0))
        var v = dy * 0.05
        var first = true
        while abs(v) > 0.5 { steps.append((v, 0, first ? 1 : 2)); first = false; v *= 0.95 }
        steps.append((0, 0, 3))
        for (i, step) in steps.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(16 * i)) {
                self.scroll(step.0, at: point, phase: step.1, momentum: step.2)
                if i == steps.count - 1 { done() }
            }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return replyHandler(nil, "bad command") }
        let dy = body["dy"] as? Double ?? 0
        let point = NSPoint(x: body["x"] as? Double ?? 640, y: body["y"] as? Double ?? 360)
        if type == "wheel" { scroll(dy, at: point); replyHandler(true, nil) }
        else if type == "flick" { flick(dy, at: point) { replyHandler(true, nil) } }
        else { replyHandler(nil, "unknown \(type)") }
    }

    func handle(_ line: String) {
        guard let data = line.data(using: .utf8),
              let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let name = command["cmd"] as? String else { return }
        switch name {
        case "load":
            if let text = command["url"] as? String, let url = URL(string: text) { web.load(URLRequest(url: url)) }
        case "call":
            let id = command["id"] as? Int ?? 0
            web.callAsyncJavaScript(command["js"] as? String ?? "", arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    if let text = value as? String { self.out(["ack": id, "value": text]) } else { self.out(["ack": id]) }
                case .failure(let error):
                    let info = (error as NSError).userInfo
                    self.out(["ack": id, "error": "\(info["WKJavaScriptExceptionMessage"] ?? error.localizedDescription) line \(info["WKJavaScriptExceptionLineNumber"] ?? "?")"])
                }
            }
        case "quit":
            exit(0)
        default:
            break
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let bridge = Bridge()
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
let script = "window.__rigNative = (command) => window.webkit.messageHandlers.rigInput.postMessage(command);"
config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "rigInput")
let frame = NSRect(x: 0, y: 0, width: 1280, height: 720)
let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.title = "Transcript list rig (WKWebView)"
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720), configuration: config)
web.navigationDelegate = bridge
bridge.web = web
window.contentView = web
window.level = .floating
window.setFrameOrigin(NSPoint(x: 0, y: 0))
window.orderFrontRegardless()

var pending = Data()
FileHandle.standardInput.readabilityHandler = { handle in
    let chunk = handle.availableData
    if chunk.isEmpty { exit(0) }
    pending.append(chunk)
    while let at = pending.firstIndex(of: 10) {
        let line = String(data: pending.subdata(in: pending.startIndex..<at), encoding: .utf8) ?? ""
        pending.removeSubrange(pending.startIndex...at)
        DispatchQueue.main.async { bridge.handle(line) }
    }
}
DispatchQueue.main.async {
    bridge.out(["ready": true, "scale": window.backingScaleFactor, "screenHz": window.screen?.maximumFramesPerSecond ?? 0, "webkit": Bundle(for: WKWebView.self).infoDictionary?["CFBundleVersion"] as? String ?? "?"])
}
app.run()
