---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-ui': minor
---

Connect real accounts to Automations. Notion and Azure DevOps take a token you paste; GitHub signs in through a code you approve in the browser, once an OAuth App is registered for it.

Until now "Connect" stored a placeholder string and showed a connected badge, so both token connectors looked ready and failed when they ran.

Credentials now live in the OS keychain rather than a file on disk, and existing stored credentials move there on first start.

Azure DevOps asks for an organization-scoped token, and says so — Microsoft stops issuing the older account-wide tokens in March 2026 and retires them in December. Notion explains why its token is manual: its API needs a server-side secret a desktop app cannot hold.

The GitHub actions no longer need the `gh` command-line tool installed and signed in. Automations that already use them keep working without being re-edited.
