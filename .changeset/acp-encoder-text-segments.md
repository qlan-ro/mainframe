---
'@qlan-ro/mainframe-types': patch
'@qlan-ro/mainframe-ui': patch
---

A turn that alternates prose and tool calls reads in the order it happened again. Since the ACP facade landed, every paragraph of an assistant turn was folded into one block at the top of the message and all of its tool calls were stacked underneath, so a reply that explained a step, ran it, explained the next one, and ran that arrived as one wall of text followed by twenty terminal cards — and the paragraphs on either side of a tool call were glued together without even a space between them. The encoder now closes a run of text when a tool call, a subagent task, or a thinking block interrupts it, and resumes the text as a new item after it, which is what the renderer was always ready to draw.
