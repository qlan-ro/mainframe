# @qlan-ro/mainframe-core

## 2.0.0-rc.16

### Minor Changes

- [#559](https://github.com/qlan-ro/mainframe/pull/559) [`69aad41`](https://github.com/qlan-ro/mainframe/commit/69aad410a149b9e608eb5b996a06b2fbabccc314) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tasks board: two-way GitHub Issues sync — link a repo, import or publish tasks, and reconcile title, body, state, and labels with an after-the-fact overwrite report.

### Patch Changes

- [#557](https://github.com/qlan-ro/mainframe/pull/557) [`7f1daf4`](https://github.com/qlan-ro/mainframe/commit/7f1daf4b30e0855457ea5a1d1226e7339d9067a4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Send a User-Agent on every automations connector request. GitHub rejects requests without one, so the `github.create_pr` and `github.list_prs` actions failed with 403 "Request forbidden by administrative rules" against the live API.

- [#553](https://github.com/qlan-ro/mainframe/pull/553) [`9e1c67b`](https://github.com/qlan-ro/mainframe/commit/9e1c67be14d2954f75d91bf69023693909af7df6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The daemon now compresses HTTP responses when the client asks for it. Requests
  advertising gzip or brotli get a compressed body and a matching
  `Content-Encoding`; requests advertising nothing get exactly the bytes they got
  before. Chat history is the biggest win — a long session's transcript is highly
  repetitive JSON, re-fetched on every WebSocket subscribe acknowledgement, and it
  crosses the cloudflared tunnel uncompressed today. Responses under 1 KB, such as
  the health check, are sent raw, and the WebSocket upgrade is deliberately left
  outside the compressor.

- [#558](https://github.com/qlan-ro/mainframe/pull/558) [`2be9b43`](https://github.com/qlan-ro/mainframe/commit/2be9b43f1773a330e8cd3ef8e28798299a7c95b8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Run the GitHub actions through the `gh` CLI instead of a hand-rolled HTTP client. `github.create_pr` and `github.list_prs` no longer ask for a token — `gh` already holds one — and `github.list_prs` now resolves `@me`, which the REST search endpoint never did. When `gh` is missing or signed out, the action catalog reports both actions unavailable and the editor mutes them with the remedy instead of offering a step that always fails.

- [#536](https://github.com/qlan-ro/mainframe/pull/536) [`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reference another session from the composer with `@`.

  Typing `@` in the composer now offers other sessions in the project alongside files and agents. Picking one inserts `@label`; sending the message prepends a reference line carrying the session's transcript path, and the sent message renders the mention as a chip instead of the raw path. Session titles are now derived from what the message showed the reader, so neither a reference line nor a preview-capture block can leak into a sidebar title.

- [#552](https://github.com/qlan-ro/mainframe/pull/552) [`0548660`](https://github.com/qlan-ro/mainframe/commit/054866036d2673751b3312aa3d87bb1a71047391) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A saved provider default model that the adapter no longer offers is dropped when a new chat is created, instead of being handed to the CLI as an unknown model id.

- [#551](https://github.com/qlan-ro/mainframe/pull/551) [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude Code workflow runs now show their phases, agents and totals in a details panel, reachable from the transcript and the background-activity popover.

- [#561](https://github.com/qlan-ro/mainframe/pull/561) [`c06fc02`](https://github.com/qlan-ro/mainframe/commit/c06fc02a5da65c7e735ec92e385b5c808c1f53df) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex sub-agent delegations (`CollabAgent`) now render as a titled sub-agent card showing the delegated task, the sub-agent's nested transcript, and its own final message. A sub-agent's turn no longer ends the parent session's turn or moves its context gauge.

- [#560](https://github.com/qlan-ro/mainframe/pull/560) [`b614ae9`](https://github.com/qlan-ro/mainframe/commit/b614ae9bc59653f40b5415fee952f075b2eba9d6) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix plan-mode approval on the Rust daemon: approving a plan now applies the execution mode you chose, and "clear context and implement" restarts the session with the plan instead of leaving it stuck in plan mode.

- Updated dependencies [[`dcbdc72`](https://github.com/qlan-ro/mainframe/commit/dcbdc72291800a1fe026f6b9e0ada95d6b415037), [`421353a`](https://github.com/qlan-ro/mainframe/commit/421353ac1518fe3df53a95fa5d67759ec7c4385e), [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04), [`f906d18`](https://github.com/qlan-ro/mainframe/commit/f906d187ef1544514d7f21a482a3f1789cbd4b04), [`4e0e305`](https://github.com/qlan-ro/mainframe/commit/4e0e305214495be90447fb0fc4c73361fd4119bb), [`4c9671d`](https://github.com/qlan-ro/mainframe/commit/4c9671dcbef9e2f6bd24a26e26a797b219bbdbab)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.16
