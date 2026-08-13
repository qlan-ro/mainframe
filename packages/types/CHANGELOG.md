# @qlan-ro/mainframe-types

## 2.0.0-rc.26

### Patch Changes

- [#629](https://github.com/qlan-ro/mainframe/pull/629) [`ce1d38d`](https://github.com/qlan-ro/mainframe/commit/ce1d38dc1408d8d70a88eed870ed24db171e71d4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop showing a padlock on providers that are installed. The boot snapshot reports every adapter as uninstalled when the CLI probe outruns the daemon's 2s cap, and the follow-up catalog event refreshed the models without clearing that flag — so a brand-new session could offer Claude's full model list while both provider tabs sat disabled. The event now carries the probe's verdict, and the client applies it.
