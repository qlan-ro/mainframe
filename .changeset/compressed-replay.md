---
'@qlan-ro/mainframe-ui': patch
---

Send chat replays compressed: a client that opts in receives a `session/resume` replay as a few zlib-deflated batches instead of one frame per item, which cuts the bytes on the wire five to ten times for a remote or tunnelled daemon. The desktop client opts in; other clients keep the plain replay.
