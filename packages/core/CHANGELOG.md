# @qlan-ro/mainframe-core

## 0.22.1

### Patch Changes

- [#380](https://github.com/qlan-ro/mainframe/pull/380) [`c3136b3`](https://github.com/qlan-ro/mainframe/commit/c3136b30c423c6b0bb147bfa0555d511256c31ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Codex sessions failing immediately with "Session ended unexpectedly". Non-fast turns were sending `serviceTier: 'flex'`, which models like gpt-5.5 reject with `400 Unsupported service_tier: flex`. The fast toggle now sends `serviceTier: 'fast'` only when on, and omits the field otherwise so Codex uses the account default tier. The failure reason from a failed Codex turn is now logged and surfaced in the error card instead of the generic message.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.22.1
