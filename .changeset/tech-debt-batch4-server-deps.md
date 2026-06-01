---
'@qlan-ro/mainframe-core': patch
---

Replace the positional parameter lists of `createHttpServer` (11 params) and `createServerManager` (10 params) with a single `HttpServerDeps` options object (`ServerManagerDeps = Omit<HttpServerDeps, 'lspManager'>`). Call sites now name what they pass instead of relying on argument order. Behavior unchanged.
