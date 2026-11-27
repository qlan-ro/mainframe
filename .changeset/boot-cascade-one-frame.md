---
"@qlan-ro/mainframe-ui": patch
"@qlan-ro/mainframe-app-tauri": patch
---

Start and reload now show one steady app frame and then the restored chat, instead of a cascade of intermediate screens. The window paints the app's ground colour from the first frame in both themes. The "Starting up" card only appears when the daemon takes longer than 200 ms. The New Session welcome, the "New Session" tab, "No sessions yet" and "quota unknown" stay out of sight until the last chat is back, and the session panel and side chat no longer open and close on the way. The usage capsule stays empty until the quota is known.
