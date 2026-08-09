---
'@qlan-ro/mainframe-ui': patch
---

Send a User-Agent on every automations connector request. GitHub rejects requests without one, so the `github.create_pr` and `github.list_prs` actions failed with 403 "Request forbidden by administrative rules" against the live API.
