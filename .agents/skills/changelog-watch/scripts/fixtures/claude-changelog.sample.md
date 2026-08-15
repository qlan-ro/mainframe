# Changelog

## 2.1.219

- Fix a crash when resuming a session with an empty transcript
- Improve error message when the permission prompt tool is unreachable

## 2.1.218

### Bug Fixes

- Fix `--resume` losing the session id on Windows
- Fix duplicate `system` init events after a compact boundary

## 2.1.217

- Add `--replay-user-messages` support for slash commands
- Add a `task_notification` usage summary to `system` events
- Deprecate the `hook_callback` control subtype in favor of `mcp_message`

## 2.1.216

- Initial support for `AskUserQuestion` suggestion destinations
- Minor cleanup of stderr noise filters
