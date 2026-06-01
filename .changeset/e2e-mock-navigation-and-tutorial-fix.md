---
---

ci(e2e): repair the three e2e-mock failures surfaced by the WS→REST transport change.

- `createTestChat` now navigates to the newly-created chat by clicking its session row
  (WS8 moved navigation out of the `chat.created` broadcast into the REST caller, which the
  raw-REST harness bypasses). A `data-chat-id` hook on the session row makes targeting deterministic.
- `launchApp` suppresses the onboarding tutorial overlay by default (opt-out for the tutorial spec)
  so it never sits over the composer and intercepts clicks (e.g. the worktree popover tabs).
