---
'@qlan-ro/mainframe-ui': patch
---

The daemon now compresses HTTP responses when the client asks for it. Requests
advertising gzip or brotli get a compressed body and a matching
`Content-Encoding`; requests advertising nothing get exactly the bytes they got
before. Chat history is the biggest win — a long session's transcript is highly
repetitive JSON, re-fetched on every WebSocket subscribe acknowledgement, and it
crosses the cloudflared tunnel uncompressed today. Responses under 1 KB, such as
the health check, are sent raw, and the WebSocket upgrade is deliberately left
outside the compressor.
