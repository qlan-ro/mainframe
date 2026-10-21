# Deferred tool images

Clients can receive tool-result images as references and fetch the original pixels when a thumbnail becomes visible or the image is selected in a gallery. This applies to live updates, resume replay, and history pages.

Opt in during `initialize`:

```json
{ "_meta": { "_mainframe.dev": { "lazyToolImages": true } } }
```

Check the daemon's `_mainframe.dev` capabilities for `lazyToolImages: true`. An older daemon ignores the opt-in and sends inline pixels. Clients that omit the opt-in continue receiving inline pixels.

A referenced ACP image keeps its MIME type and position in the tool result:

```json
{
  "type": "content",
  "content": {
    "type": "image",
    "mimeType": "image/png",
    "data": "",
    "uri": "/api/chats/chat_1/tool-result/tool_1/images/0?v=0123456789abcdef"
  }
}
```

## GET /api/chats/{chatId}/tool-result/{toolCallId}/images/{index}

Fetch one tool-result image, including images from nested subagent tools.

| Parameter | Meaning |
| --- | --- |
| `chatId` | Daemon chat ID |
| `toolCallId` | Tool call or task ID |
| `index` | Zero-based index among that tool result's images; text entries do not count |
| `v` | Opaque content version for client cache keys; not an authorization token |

Use the active daemon's base URL and the same bearer authentication as other REST requests. Only accept daemon-relative image paths; never forward daemon credentials to an arbitrary image URL.

A successful response contains the original base64 bytes:

```json
{ "success": true, "data": { "mediaType": "image/png", "data": "iVBOR…" } }
```

Invalid identifiers return 400. A missing chat, tool, or image returns 404. The endpoint resolves the current image at that tool/index; it does not retain past versions. A revised result supplies a new versioned URI.

The desktop client shares pending requests and keeps a bounded cache of fetched image data. Changing the active daemon clears the cache. Failed requests are evicted and can be retried from the thumbnail or gallery.

This capability preserves the canonical transcript and revision cursors. It does not change the history window's container limit or bound the number of operations inside a container.
