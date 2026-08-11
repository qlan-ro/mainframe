# WKWebView Thread Bottom-Pin Design

## Problem

Tauri's WKWebView can lose a chat thread's bottom position when transcript content briefly shrinks and then regrows without a corresponding DOM mutation. During the shrink, WebKit clamps `scrollTop` to the smaller maximum. When the content regrows, the viewport keeps that numeric position and exposes much older messages.

The current assistant-ui viewport observes the viewport element and transcript mutations. A descendant's intrinsic or animated height can change while the viewport's border box and DOM tree remain stable, so neither observer reports the restored content height.

## Goal

Keep a thread pinned to its newest content across descendant-only height changes when the reader was already at the bottom. Preserve the reader's position after any deliberate scroll away from the bottom.

## Approaches

### Observe the transcript content wrapper

Add a Mainframe hook that observes the existing transcript wrapper with `ResizeObserver`. The hook tracks whether the viewport is pinned from its scroll position. When the wrapper's size changes while pinned, it scrolls the viewport to its new maximum on the next animation frame.

This is the recommended approach. It covers WebKit's missed layout changes, stays within Mainframe, and preserves assistant-ui's public behavior.

### Patch assistant-ui

Modify or patch `useOnResizeContent` so it observes a dedicated content element. This would address the issue closer to its source, but assistant-ui does not expose that element through its viewport primitive. Maintaining a package patch would also couple Mainframe to library internals.

### Run a scroll watchdog while the agent works

Poll the viewport height or force the bottom during an active run. This would hide the symptom, but it would waste work, risk overriding intentional scrolling, and miss late asynchronous layout changes after a run ends.

## Design

Create a focused hook beside `ChatThread`. It returns callback refs for the viewport and transcript content wrapper.

The viewport ref stores the scroll element and listens for `scroll` events. A viewport counts as pinned when its distance from the bottom is at most two CSS pixels or its content does not overflow. User scrolling above that threshold clears the pinned flag; returning to the bottom restores it.

The content ref owns a `ResizeObserver`. On each content-size notification, it schedules one animation-frame callback. If the viewport remains pinned, the callback assigns the viewport's current `scrollHeight` to `scrollTop`. Coalescing notifications prevents repeated synchronous layout writes during animated or streamed updates.

`ChatThread` attaches the viewport ref to `ThreadPrimitive.Viewport` and the content ref to the existing centered transcript wrapper. assistant-ui remains responsible for run-start, initialization, thread-switch, and scroll-to-bottom-button behavior. The Mainframe hook handles only content-box size changes that assistant-ui misses.

## Lifecycle and cleanup

Replacing either ref removes listeners or disconnects the previous observer. Unmounting cancels the pending animation frame. The hook stores no position outside the mounted thread and adds no persistence.

If `ResizeObserver` is unavailable, the hook leaves assistant-ui's existing behavior unchanged.

## Testing

Add hook tests with a controlled viewport and `ResizeObserver` stub.

1. Reproduce the WKWebView sequence: start pinned, shrink and clamp at the new bottom, regrow the content, fire the content observer, and confirm the viewport returns to the new bottom.
2. Scroll away from the bottom, resize the content, and confirm the hook leaves `scrollTop` unchanged.
3. Return to the bottom, resize again, and confirm bottom-following re-engages.
4. Unmount with a queued frame and confirm cleanup cancels it and disconnects the observer.

Run the focused Vitest file and the UI typecheck. Re-run the real Tauri/WKWebView shrink-regrow diagnostic to verify the 100,000-pixel gap remains zero.

## Acceptance criteria

- A pinned WKWebView thread stays at the bottom after transcript content shrinks and regrows.
- Scrolling up prevents content resizes from changing the reader's position.
- Scrolling back to the bottom re-enables bottom-following.
- The existing assistant-ui initialization, run-start, thread-switch, and button behavior remains unchanged.
- The fix adds no polling and no package patch.
