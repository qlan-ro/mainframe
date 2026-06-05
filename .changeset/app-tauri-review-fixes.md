---
"@qlan-ro/mainframe-app-tauri": patch
---

Thermo-nuclear review fixes for the composer leaf: fixed the optimistic-send crash (user messages
must not carry a `status` field) and a queued-edit content mix-up (ComposerEditMode now keyed per
message); collapsed the `lib/api` envelope-unwrap into one `request<T>` helper; routed queued
cancel/edit + the composer port through the controller seam (no more `getDaemonPort()` in leaf
components) and fixed the toolbar staying enabled mid-run; moved attachment `toUploadItems` to its
adapter and dropped the daemon-derived `sizeBytes`/`kind`; plus dead-code removal, fullBytes
de-casts, a typed `makeUserMessage` factory, and tests for the send/attachment/tuning paths.
