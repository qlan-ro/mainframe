# @qlan-ro/mainframe-types

## 2.0.0-rc.22

## 2.0.0-rc.21

### Patch Changes

- [#579](https://github.com/qlan-ro/mainframe/pull/579) [`feebc74`](https://github.com/qlan-ro/mainframe/commit/feebc74c25681719d71d9eb7ecf99768735d92c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Agent descriptions in the `@` picker come from frontmatter instead of rendering `---`.

- [#583](https://github.com/qlan-ro/mainframe/pull/583) [`f2a9d0b`](https://github.com/qlan-ro/mainframe/commit/f2a9d0bb2891d766f5db603c8c47e4f7c7c50f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix remote daemons paired over plain http: the paired scheme is now persisted and honored everywhere the endpoint is rebuilt, so an http remote connects instead of silently becoming unreachable. Plain http is refused at pairing time for any host other than loopback, with a clear explanation before a pairing code is spent.

- [#585](https://github.com/qlan-ro/mainframe/pull/585) [`7176cca`](https://github.com/qlan-ro/mainframe/commit/7176ccaccfd3d9edd0d553f755f83630b286559d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add the `ultra` reasoning-effort level so the composer can offer and persist it.
