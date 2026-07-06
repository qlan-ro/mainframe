/// macOS-only WKWebView snapshot capture.
///
/// Uses `tauri::Webview::with_webview` to access the raw WKWebView handle,
/// calls `takeSnapshotWithConfiguration:completionHandler:`, then encodes the
/// resulting NSImage as a DPR-aware PNG.
///
/// # Async design (Findings 1 + 5)
/// `WKWebView.takeSnapshotWithConfiguration:completionHandler:` dispatches its
/// completion handler **asynchronously** on the main thread — a sync
/// read-after-invoke always returns `None`.
///
/// The fix splits the operation into two phases so no borrow of `&tauri::Webview`
/// is held across an await point:
///
/// 1. `schedule_capture` — borrows `&tauri::Webview` only long enough to call
///    `with_webview` (a synchronous dispatch onto the main thread).  The
///    closure wires the ObjC completion block to a `tokio::sync::oneshot::Sender`
///    and returns.  `schedule_capture` returns the owned `Receiver` immediately.
/// 2. `preview_capture` (in mod.rs) `.await`s the `Receiver` with the borrow
///    already released — no Tokio worker thread is parked (Finding 5).
///
/// # Safety
/// All ObjC calls are `unsafe` by definition. The casts rely on Tauri's
/// `PlatformWebview::inner()` returning a `*mut c_void` pointing to a
/// `WKWebView`, and `ns_window()` pointing to an `NSWindow`. Verified against
/// tauri 2.11.2 + wry 0.55.1 + objc2-web-kit 0.3.2.
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;

#[cfg(target_os = "macos")]
use objc2_app_kit::NSImage;

/// Raw snapshot payload: `(rgba_bytes, width, height, device_pixel_ratio)`.
#[cfg(target_os = "macos")]
type SnapshotResult = Result<(Vec<u8>, u32, u32, f64), String>;

/// Oneshot receiver for a snapshot scheduled on the WKWebView main thread.
#[cfg(target_os = "macos")]
type SnapshotReceiver = tokio::sync::oneshot::Receiver<SnapshotResult>;

/// Schedule a WKWebView snapshot and return the oneshot receiver.
///
/// This is the **only** function that borrows `&tauri::Webview`.  It is
/// synchronous and returns before any async suspension, so the caller
/// (`preview_capture` in mod.rs) can drop the borrow before awaiting.
#[cfg(target_os = "macos")]
pub fn schedule_capture(webview: &tauri::Webview) -> Result<SnapshotReceiver, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<SnapshotResult>();

    // `with_webview` enqueues the closure on the main thread and returns
    // immediately.  We move `tx` into the closure; the ObjC completion block
    // will send through it when the snapshot is ready.
    webview
        .with_webview(move |platform_wv| {
            unsafe { schedule_snapshot(&platform_wv, tx) };
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    Ok(rx)
}

/// Register the ObjC `takeSnapshot` call on the main-thread WKWebView.
/// Runs inside the `with_webview` closure (already on the main thread).
/// The ObjC completion block fires **asynchronously** on the same thread
/// and sends its result into `tx`.
#[cfg(target_os = "macos")]
unsafe fn schedule_snapshot(
    platform_wv: &tauri::webview::PlatformWebview,
    tx: tokio::sync::oneshot::Sender<SnapshotResult>,
) {
    // Cast raw *mut c_void → &WKWebView.
    let wk_wv: &WKWebView = &*(platform_wv.inner() as *const WKWebView);

    // Device-pixel ratio from the NSWindow backing scale factor.
    let dpr: f64 = {
        use objc2_app_kit::NSWindow;
        let ns_win_ptr = platform_wv.ns_window();
        if ns_win_ptr.is_null() {
            2.0 // safe default for Retina
        } else {
            let ns_win: &NSWindow = &*(ns_win_ptr as *const NSWindow);
            ns_win.backingScaleFactor()
        }
    };

    // `RcBlock::new` requires `Fn`, not `FnMut`, so we wrap `tx` in an
    // `Arc<Mutex<Option<...>>>` for interior-mutable single-fire semantics.
    let tx_slot = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let handler = block2::RcBlock::new(move |image: *mut NSImage, _err: *mut objc2_foundation::NSError| {
        let outcome = if image.is_null() {
            Err("takeSnapshot returned a nil NSImage".to_string())
        } else {
            unsafe { nsimage_to_rgba(&*image, dpr) }
        };
        // Take the sender out once; subsequent calls (should never happen) are no-ops.
        let maybe_sender = tx_slot.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(sender) = maybe_sender {
            let _ = sender.send(outcome);
        }
    });

    // nil config → full-view snapshot.
    wk_wv.takeSnapshotWithConfiguration_completionHandler(None, &handler);
}

/// Convert `NSImage` → RGBA bytes via `NSBitmapImageRep`.
#[cfg(target_os = "macos")]
unsafe fn nsimage_to_rgba(image: &NSImage, dpr: f64) -> Result<(Vec<u8>, u32, u32, f64), String> {
    use objc2_app_kit::NSBitmapImageRep;

    let tiff = image.TIFFRepresentation().ok_or("NSImage.TIFFRepresentation is nil")?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or("NSBitmapImageRep.imageRepWithData returned nil")?;

    let width = rep.pixelsWide() as u32;
    let height = rep.pixelsHigh() as u32;
    if width == 0 || height == 0 {
        return Err("snapshot produced a zero-size image".to_string());
    }

    let bytes_per_row = rep.bytesPerRow() as usize;
    let bits_per_pixel = rep.bitsPerPixel() as usize;
    let bpp = bits_per_pixel / 8; // bytes per pixel

    let bitmap_ptr = rep.bitmapData();
    if bitmap_ptr.is_null() {
        return Err("NSBitmapImageRep.bitmapData is null".to_string());
    }

    let raw: &[u8] = std::slice::from_raw_parts(bitmap_ptr, bytes_per_row * height as usize);

    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for row in 0..height as usize {
        let row_start = row * bytes_per_row;
        for col in 0..width as usize {
            let px = row_start + col * bpp;
            match bpp {
                4 => {
                    rgba.extend_from_slice(&raw[px..px + 4]);
                }
                3 => {
                    rgba.extend_from_slice(&raw[px..px + 3]);
                    rgba.push(255);
                }
                _ => {
                    let v = raw[px];
                    rgba.extend_from_slice(&[v, v, v, 255]);
                }
            }
        }
    }

    Ok((rgba, width, height, dpr))
}

/// Crop an RGBA byte buffer to a `PixelRect`.
#[cfg(target_os = "macos")]
pub fn crop_rgba(rgba: &[u8], img_w: u32, rect: crate::preview::crop::PixelRect) -> Vec<u8> {
    let mut out = Vec::with_capacity((rect.w * rect.h * 4) as usize);
    for row in rect.y..(rect.y + rect.h) {
        let row_start = (row * img_w + rect.x) as usize * 4;
        let row_end = row_start + (rect.w as usize * 4);
        out.extend_from_slice(&rgba[row_start..row_end]);
    }
    out
}

/// Encode raw RGBA bytes as PNG.
#[cfg(target_os = "macos")]
pub fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use png::{BitDepth, ColorType, Encoder};

    let mut buf = Vec::new();
    {
        let mut encoder = Encoder::new(std::io::Cursor::new(&mut buf), width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        let mut writer =
            encoder.write_header().map_err(|e| format!("png encode header: {e}"))?;
        writer.write_image_data(rgba).map_err(|e| format!("png encode data: {e}"))?;
    }
    Ok(buf)
}
