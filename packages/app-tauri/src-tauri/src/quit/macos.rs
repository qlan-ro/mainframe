use std::sync::OnceLock;

use objc2::runtime::{AnyObject, Imp, Sel};
use objc2::{sel, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSApplicationTerminateReply, NSModalPanelRunLoopMode};
use objc2_core_foundation::{kCFRunLoopDefaultMode, CFArray, CFRunLoop, CFString};
use tauri::AppHandle;

use super::{start, Exit, Request, SHUTDOWN};

type ShouldTerminate =
    extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> NSApplicationTerminateReply;

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn install_native_quit(app: &AppHandle) {
    let Some(main) = MainThreadMarker::new() else {
        return;
    };
    let Some(delegate) = NSApplication::sharedApplication(main).delegate() else {
        tracing::warn!("native quit delegate unavailable");
        return;
    };
    if APP.set(app.clone()).is_err() {
        return;
    }
    let delegate: &AnyObject = delegate.as_ref();
    // Tao reports applicationWillTerminate after AppKit has committed to exit.
    let installed = unsafe {
        let imp = std::mem::transmute::<ShouldTerminate, Imp>(should_terminate);
        objc2::ffi::class_addMethod(
            std::ptr::from_ref(delegate.class()).cast_mut(),
            sel!(applicationShouldTerminate:),
            imp,
            c"Q@:@".as_ptr(),
        )
    };
    if !installed.as_bool() {
        tracing::warn!("could not install native quit delegate method");
    }
}

extern "C-unwind" fn should_terminate(
    _: &AnyObject,
    _: Sel,
    _: &NSApplication,
) -> NSApplicationTerminateReply {
    let Some(app) = APP.get() else {
        return NSApplicationTerminateReply::TerminateNow;
    };
    match SHUTDOWN.request() {
        Request::Start => {
            start(app, Exit::Native);
            NSApplicationTerminateReply::TerminateLater
        }
        Request::Defer => NSApplicationTerminateReply::TerminateCancel,
        Request::Allow => NSApplicationTerminateReply::TerminateNow,
    }
}

pub(super) fn complete_quit(app: &AppHandle) {
    let (Some(run_loop), Some(default_mode)) =
        (CFRunLoop::main(), unsafe { kCFRunLoopDefaultMode })
    else {
        app.exit(0);
        return;
    };
    // AppKit can wait in its modal run-loop mode after NSTerminateLater.
    let modal_mode: &CFString = unsafe { NSModalPanelRunLoopMode }.as_ref();
    let modes = CFArray::from_objects(&[default_mode, modal_mode]);
    let reply = block2::RcBlock::new(|| {
        if let Some(main) = MainThreadMarker::new() {
            NSApplication::sharedApplication(main).replyToApplicationShouldTerminate(true);
        }
    });
    // SAFETY: CFRunLoopPerformBlock is thread-safe and copies the block.
    unsafe { run_loop.perform_block(Some(&modes), Some(&reply)) };
    run_loop.wake_up();
}
