# Transcript item paging

Desktop requests both `containers: 40` and `items: 80` in the ACP history window and earlier-page request. The item budget limits encoded prose, reasoning and tool operations within a container; one large assistant turn no longer bypasses the window. The server clamps explicit item budgets to 1–200.

Required parent task cards accompany a selected child as context. They do not move `floorItemId`, which identifies the first selected chronological item. The count may exceed the budget by these ancestor cards. This is an item bound, not a byte bound: a single prose or tool item can still be large. Tool-result images retain lazy references.

## Paging and reconnect

`hasMore` includes earlier items within the floor container, even when it is the transcript's first container. An earlier page excludes the current floor, retains parent context and advances the floor within that same container when necessary. Client and daemon merge shared context without duplicating cards or losing the already loaded suffix. The canonical encoder emits each task parent and its complete subtree before siblings.

The reader is anchored to a visible prose or tool item while a page extends an existing container. Live deltas suppress the hidden prefix. Removing or moving the floor to another container invalidates the window and requests resync. Revision reconnect preserves the complete loaded range, including more than one page, instead of reapplying the initial item budget. The client returns the server-provided `contextItemIds` alongside its floor. If the required ancestors changed while disconnected, the server replaces that same loaded range to restore their order. A live change that introduces an unknown ancestor requests resync.

Opening a subagent zone whose task card is context loads through that card, restoring its earlier children. Find checks the requested item rather than assuming a visible container is complete. An explicit `untilItemId` bypasses the item budget and loads the contiguous range down to that target in one request. Search scope and exact totals keep their existing semantics.

## Compatibility

Both item fields are optional. Omitting them preserves container-only behavior for existing clients. An older daemon ignores the extra request fields and serves its existing container window; no additional handshake is required.
