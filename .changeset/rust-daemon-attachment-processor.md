---
'@qlan-ro/mainframe-app-tauri': patch
---

Port the attachment processor to the Rust daemon. Images and files sent with a message were silently dropped (the `processAttachments` seam was an unported stub), so screenshots and file attachments never reached the agent. They now become inline image content and `<attached_file_path>` prefixes, matching the Node daemon.
