# Triage Labels

The skills speak in terms of five canonical triage roles. This repo uses the default vocabulary as-is, stored in each todo's `labels` JSON column (not GitHub-style labels).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role, add/remove the corresponding string in the todo's `labels` array.

The `labels` column also carries non-triage tags — component names (`monaco`, `chat`, …) and `wayfinder:*` markers. Preserve them when mutating the array; triage roles coexist with them rather than replacing them.
