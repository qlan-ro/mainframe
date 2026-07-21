---
'@qlan-ro/mainframe-app-tauri': patch
---

Close six functional gaps in the Rust daemon so it matches the Node daemon:

- **Attachments**: images and files sent with a message were silently dropped (unported `processAttachments` stub); they now become inline image content and `<attached_file_path>` prefixes.
- **Codex model catalog**: accept the `ultra` reasoning-effort variant; the codex `model/list` response no longer fails deserialization, so the catalog populates instead of staying empty.
- **Suggestions**: `GET /api/projects/:id/suggestions` is ported and mounted (churn + TODO-scan starting points for the Welcome panel).
- **External sessions**: the scan/import routes are wired through the ChatManager facade instead of returning 500, so external CLI sessions can be discovered and imported.
- **Resume re-scan**: reopening a chat re-runs PR-URL detection, @-mention extraction, and plan/skill-file extraction, matching Node.
- **Workspace trust**: `writeWorkspaceTrust` is ported and the trust-workspace command persists trust for the chat's worktree or project root.
