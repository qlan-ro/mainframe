/// macOS-only WKWebView snapshot capture.
///
/// Uses `tauri::Webview::with_webview` to access the raw WKWebView handle,
/// calls `takeSnapshotWithConfiguration:completionHandler:`, then encodes the
/// resulting NSImage as a DPR-aware PNG. The completion handler runs on the
/// main thread; a `std::sync::mpsc` channel bridges the result back to the
/// async Tauri command caller.
///
/// # Safety
/// All ObjC calls are `unsafe` by definition. The casts rely on Tauri's
/// `PlatformWebview::inner()` returning a `*mut c_void` pointing to a
/// `WKWebView`, and `ns_window()` pointing to an `NSWindow`. Verified against
/// tauri 2.11.2 + wry 0.55.1 + objc2-web-kit 0.3.2.
#[cfg(target_os = "macos")]
use std::sync::mpsc;

#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSBitmapImageRep, NSImage, NSWindow};

#[cfg(target_os = "macos")]
use objc2_foundation::NSError;

#[cfg(target_os = "macos")]
use crate::preview::crop::{clamp_rect, scale_region, Region};

/// Full-webview or region snapshot → PNG bytes.
#[cfg(target_os = "macos")]
pub fn capture_png(webview: &tauri::Webview, region: Option<Region>) -> Result<Vec<u8>, String> {
    let (tx, rx) = mpsc::channel::<Result<(Vec<u8>, u32, u32, f64), String>>();

    // `with_webview` dispatches the closure on the main thread.
    webview
        .with_webview(move |platform_wv| {
            let result = unsafe { snapshot_rgba(&platform_wv) };
            let _ = tx.send(result);
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    // Block this async task until the main-thread closure sends.
    let (rgba, img_w, img_h, dpr) =
        rx.recv().map_err(|_| "snapshot channel closed unexpectedly".to_string())??;

    match region {
        None => encode_png(&rgba, img_w, img_h),
        Some(r) => {
            let rect = clamp_rect(scale_region(r, dpr), img_w, img_h);
            if rect.w == 0 || rect.h == 0 {
                return Err("capture region is empty after clamping".to_string());
            }
            let cropped = crop_rgba(&rgba, img_w, rect);
            encode_png(&cropped, rect.w, rect.h)
        }
    }
}

/// Obtain RGBA bytes from WKWebView via `takeSnapshot`.
/// Runs on the main thread (inside `with_webview`).
/// Returns `(rgba_bytes, width, height, dpr)`.
#[cfg(target_os = "macos")]
unsafe fn snapshot_rgba(
    platform_wv: &tauri::webview::PlatformWebview,
) -> Result<(Vec<u8>, u32, u32, f64), String> {
    use std::sync::{Arc, Mutex};

    // Cast raw *mut c_void → &WKWebView.
    let wk_wv: &WKWebView = &*(platform_wv.inner() as *const WKWebView);

    // Device-pixel ratio from the NSWindow backing scale.
    let dpr: f64 = {
        let ns_win_ptr = platform_wv.ns_window();
        if ns_win_ptr.is_null() {
            2.0 // safe default for Retina
        } else {
            let ns_win: &NSWindow = &*(ns_win_ptr as *const NSWindow);
            ns_win.backingScaleFactor()
        }
    };

    // Slot for the ObjC completion handler result.
    let result_slot: Arc<Mutex<Option<Result<(Vec<u8>, u32, u32, f64), String>>>> =
        Arc::new(Mutex::new(None));
    let slot_for_block = result_slot.clone();

    // Build and invoke the completion handler block.
    let handler = block2::RcBlock::new(move |image: *mut NSImage, _err: *mut NSError| {
        let outcome = if image.is_null() {
            Err("takeSnapshot returned a nil NSImage".to_string())
        } else {
            unsafe { nsimage_to_rgba(&*image, dpr) }
        };
        *slot_for_block.lock().unwrap_or_else(|e| e.into_inner()) = Some(outcome);
    });

    // `takeSnapshotWithConfiguration:completionHandler:` — nil config → full view.
    wk_wv.takeSnapshotWithConfiguration_completionHandler(None, &*handler);

    // On the main thread the completion block fires synchronously.
    // Extract into a local to drop the MutexGuard before the Arc is dropped.
    let outcome = result_slot
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_else(|| Err("snapshot completion handler never fired".to_string()));
    outcome
}

/// Convert `NSImage` → RGBA bytes via `NSBitmapImageRep`.
#[cfg(target_os = "macos")]
unsafe fn nsimage_to_rgba(image: &NSImage, dpr: f64) -> Result<(Vec<u8>, u32, u32, f64), String> {
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

    let raw: &[u8] =
        std::slice::from_raw_parts(bitmap_ptr, bytes_per_row * height as usize);

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
