---
'@qlan-ro/mainframe-ui': patch
---

A markdown link in the transcript whose target is a file path (an absolute path, a project-relative path, or a `file://` URI, optionally suffixed with `:line` or `:line:col`) now renders as a file reference instead of a web link: clicking it opens the file in the workspace surface through the existing open-file surface intent, jumping to the line when one is given, and its context menu offers Open file plus Copy absolute/relative path instead of Copy link/Open link. A `file://` link, which previously rendered as a dead anchor once the sanitiser stripped its href, now opens correctly. Genuine http(s) links, the localhost tunnel chip, and the smart-action chips are unchanged. The message-level path context menu (right-clicking a tool-card file-path pill) also gained an Open file item alongside its existing copy actions.
