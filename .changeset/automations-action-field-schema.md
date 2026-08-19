---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Fix "Run an action" steps, which could not be configured at all. The daemon described each action's parameters as JSON Schema while the editor expected a different shape, so every action rendered an empty form — no script field for Run command, no URL for an HTTP request — and the step saved with no parameters and failed when it ran. The daemon now publishes the field descriptions the editor actually needs, so the form appears.

Two bugs fell out of making both sides share one schema. A custom working directory for Run command was written under a key the engine never read, so filling it in produced "path required" while the path sat there on screen. And "Treat output as" was tied to Run command specifically, so Read file silently lost the setting it also supports.

The action catalog now also says whether an action is safe to repeat, which turns the Retry block's warning from a blanket disclaimer into a specific one: it names the steps that would run twice — "Retrying will run these again: Open a pull request" — and disappears entirely when everything in the block is safe.

One removal worth noting: Notion's column picker was demonstration data with nothing behind it, offering databases and columns that did not exist. It is gone until there is a real lookup; the step takes explicit key/value pairs, as it always did in practice.
