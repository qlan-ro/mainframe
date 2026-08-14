---
'@qlan-ro/mainframe-ui': patch
---

Sort the sidebar's session list by recent activity in every grouping. Grouping by project used to list each project's sessions in the order the app happened to receive them — an order that changed between restarts — and the name and status modes left their ties there too. Each section now leads with the most recently active session, and every mode resolves ties the same way.
