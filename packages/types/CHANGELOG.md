# @qlan-ro/mainframe-types

## 2.0.0-rc.16

### Minor Changes

- [#536](https://github.com/qlan-ro/mainframe/pull/536) [`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reference another session from the composer with `@`.

  Typing `@` in the composer now offers other sessions in the project alongside files and agents. Picking one inserts `@label`; sending the message prepends a reference line carrying the session's transcript path, and the sent message renders the mention as a chip instead of the raw path. Session titles are now derived from what the message showed the reader, so neither a reference line nor a preview-capture block can leak into a sidebar title.

- [#563](https://github.com/qlan-ro/mainframe/pull/563) [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Browse skills.sh from the Setup Advisor. The Skills section is now one list — the skills you have, then the registry's most-installed — with search covering the whole registry rather than the visible rows. An installed row reads "Installed" and swaps to Uninstall on hover, so no row offers to install something you already have; installing asks which scope on the Install button itself, at the moment you install. Two daemon routes back it, and the list degrades to search-only when the registry catalog can't be read, keeping your installed rows. Both reads report themselves: the list waits as skeletons rather than briefly offering to install skills you already have, and a refresh or a search marks the search field while it runs.

- [#563](https://github.com/qlan-ro/mainframe/pull/563) [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Install and uninstall skills from the Setup Advisor's new Skills section, run through the `skills` CLI on the daemon host.

- [#551](https://github.com/qlan-ro/mainframe/pull/551) [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude Code workflow runs now show their phases, agents and totals in a details panel, reachable from the transcript and the background-activity popover.

- [#548](https://github.com/qlan-ro/mainframe/pull/548) [`4c9671d`](https://github.com/qlan-ro/mainframe/commit/4c9671dcbef9e2f6bd24a26e26a797b219bbdbab) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude's attention requests now raise a Mainframe notification, including a native desktop banner, with a new Chat setting to turn them off.

### Patch Changes

- [#550](https://github.com/qlan-ro/mainframe/pull/550) [`421353a`](https://github.com/qlan-ro/mainframe/commit/421353ac1518fe3df53a95fa5d67759ec7c4385e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A project whose directory is gone is now marked unavailable in the switcher, its sessions refuse to send with the real reason instead of failing silently, and the recovery card sits above the composer in the thread's sticky footer instead of at the top of the transcript, where it stayed visible but scrolled out of reach.
