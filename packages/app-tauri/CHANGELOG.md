# @qlan-ro/mainframe-app-tauri

## 2.0.0-rc.22

### Patch Changes

- Updated dependencies [[`e2ed4bf`](https://github.com/qlan-ro/mainframe/commit/e2ed4bf33603fb378106cf9d4652551ffe6f0920)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.22

## 2.0.0-rc.21

### Patch Changes

- [#583](https://github.com/qlan-ro/mainframe/pull/583) [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix remote daemons paired over plain http: the paired scheme is now persisted and honored everywhere the endpoint is rebuilt, so an http remote connects instead of silently becoming unreachable. Plain http is refused at pairing time for any host other than loopback, with a clear explanation before a pairing code is spent.

- [#578](https://github.com/qlan-ro/mainframe/pull/578) [`0f1e979`](https://github.com/qlan-ro/mainframe/commit/0f1e979f601b8ee5467b593f4dbdb89b4f7e3ea8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The daemon no longer discards a chat's events for the client that sent the
  message. A client that sends a message and only then subscribes to the chat
  used to lose its own message's events for that connection — there was no
  replay. The sending connection is now a subscriber of the chat it sends to,
  released as usual on unsubscribe or disconnect.
- Updated dependencies [[`6275932`](https://github.com/qlan-ro/mainframe/commit/6275932c03fdac43301363122dfbcb945951abf4), [`527f906`](https://github.com/qlan-ro/mainframe/commit/527f9068f291f64a6453f0f4b141b8994cb368d1), [`faa4676`](https://github.com/qlan-ro/mainframe/commit/faa46762880b5da4f3bd77258972cc50c6553cc9), [`ed219f7`](https://github.com/qlan-ro/mainframe/commit/ed219f779e4d7cf9fced0792cbf82e117cbb8ec3), [`034ac5f`](https://github.com/qlan-ro/mainframe/commit/034ac5f147bd0327edc63db4d8d04c98244a3fd8), [`373f085`](https://github.com/qlan-ro/mainframe/commit/373f085472643632c3ed01e9f0ffcef4de32fb61), [`181bff0`](https://github.com/qlan-ro/mainframe/commit/181bff09a3e96560a128df3bc43c0a1dbef2851f), [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52), [`3f63f15`](https://github.com/qlan-ro/mainframe/commit/3f63f157ffc966af0e3c0e805252beb5c5e24e1f), [`7176cca`](https://github.com/qlan-ro/mainframe/commit/7176ccaccfd3d9edd0d553f755f83630b286559d)]:
  - @qlan-ro/mainframe-ui@2.0.0-rc.21
