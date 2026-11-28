# @qlan-ro/mainframe-app-tauri

## 2.5.0

### Minor Changes

- [#934](https://github.com/qlan-ro/mainframe/pull/934) [`92d0e4f`](https://github.com/qlan-ro/mainframe/commit/92d0e4fe63fbfb43f78519234b90299a3e32167d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - External MCP clients can wait for a chat to finish or ask for input instead of polling, and a client you allow in Settings can answer its permission prompts, questions and plan approvals for hands-free use.

- [#946](https://github.com/qlan-ro/mainframe/pull/946) [`3724775`](https://github.com/qlan-ro/mainframe/commit/3724775b16b9e983ec6241ce800c71ddabd78c33) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer is one card that carries its context: project and branch above it in a new session, ongoing work above it after that, and where the session runs, its branch and its changes below. While a turn runs, a message can be queued or steered into the turn (Settings › Chat picks which one Enter does), Stop ends the turn and its sub-agents, and messages a stop held back wait in the composer. Requests from sub-agents and delegated tasks show above the composer on their own, oldest first, and Unattended asks once per session. Picking another provider's model switches the chat without a confirmation. “Always allow” lists everything it saves and says what it leaves out: a permission mode wider than Auto-Edits, or a suggestion the app cannot read, is never saved from a prompt, whichever client answers. The command a request runs shows whole, cannot be allowed before its end was shown, and what is approved keeps its stored order whatever its script.

- [#943](https://github.com/qlan-ro/mainframe/pull/943) [`7c97c6d`](https://github.com/qlan-ro/mainframe/commit/7c97c6d71adeb9b369538d1fa773051fc059437f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The title bar is split into segments that line up with the columns below it, workspace tabs move into it, and Chat and Workspace become two plain toggles. Session tabs show each session's status, both tab rows work from the keyboard, and the chat header no longer carries a tasks chip.

- [#950](https://github.com/qlan-ro/mainframe/pull/950) [`d6ff937`](https://github.com/qlan-ro/mainframe/commit/d6ff9379750381c7f046e6e9a07bd0e8dfe656c5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Forks, side chats, delegated tasks, sub-agents and any session you want beside the conversation now open as workspace tabs, and the chat column always holds one conversation. Closing a chat tab keeps the chat and its unsent message. Split views and open side chats become workspace tabs when you upgrade. The workspace slides in beside the chat, and closing its last tab closes it.

### Patch Changes

- [#996](https://github.com/qlan-ro/mainframe/pull/996) [`1ea1979`](https://github.com/qlan-ro/mainframe/commit/1ea19797234875cb0e003eae8c89e8868b457d5d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Load large sub-agent and older history pages faster: the daemon sends them as binary WebSocket frames that the app inflates natively, and updates are validated by tag.

- [#1006](https://github.com/qlan-ro/mainframe/pull/1006) [`5f48ba9`](https://github.com/qlan-ro/mainframe/commit/5f48ba95d4af635e232d53d646b16e5598f55019) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Start and reload now show one steady app frame and then the restored chat, instead of a cascade of intermediate screens. The window paints the app's ground colour from the first frame in both themes. The "Starting up" card only appears when the daemon takes longer than 200 ms. The New Session welcome, the "New Session" tab, "No sessions yet" and "quota unknown" stay out of sight until the last chat is back, and the session panel and side chat no longer open and close on the way. The usage capsule stays empty until the quota is known.

- [#1008](https://github.com/qlan-ro/mainframe/pull/1008) [`412c6ca`](https://github.com/qlan-ro/mainframe/commit/412c6cad802c04da39d613ddad1d1ccfad4fb058) Thanks [@doruchiulan](https://github.com/doruchiulan)! - In the plain transcript list (preview setting), the loaded history stays bounded: it shrinks to the newest page when you scroll back to the bottom. A jump to something not loaded (a Find match, an Activity row, a link) loads a window around it instead of everything in between, and scrolling on from it reaches the latest messages. Find in that list uses only daemon search. The daemon can now raise a connection's history floor (`_mainframe.dev/history_trim`), so a window cut back to the newest page still pages.

- [#1004](https://github.com/qlan-ro/mainframe/pull/1004) [`f17ae53`](https://github.com/qlan-ro/mainframe/commit/f17ae53e138ef0effdadc601c51ee8f74a0c254b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open an uncached Claude chat faster: the first transcript window now comes from the end of the transcript file, read backwards until it holds enough whole turns, instead of waiting for the whole file to parse. The full load still follows, and an ambiguous cut (other transcripts for the session, copied history, a tool result whose call is earlier) keeps the full read.

- [#975](https://github.com/qlan-ro/mainframe/pull/975) [`c7815b4`](https://github.com/qlan-ro/mainframe/commit/c7815b4a5d4339987ea903b8a39213aad29dff1d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queue Claude and Codex prompts until the current turn finishes. Keep steered messages inside their turn, including after reloading history.

- [#995](https://github.com/qlan-ro/mainframe/pull/995) [`004879d`](https://github.com/qlan-ro/mainframe/commit/004879d1627a557c09b8e66461e5203224610309) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open an uncached Codex chat faster: the first transcript window now comes from the newest turns (`thread/turns/list`) instead of waiting for the whole thread to load. CLIs without that method keep the full read.

- [#971](https://github.com/qlan-ro/mainframe/pull/971) [`b2ef44f`](https://github.com/qlan-ro/mainframe/commit/b2ef44f7974b0003461c731573461460fd7f7a1e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Release idle Codex sessions and their app-server helpers while preserving the chat for later resume.

- [#1002](https://github.com/qlan-ro/mainframe/pull/1002) [`fa4af14`](https://github.com/qlan-ro/mainframe/commit/fa4af14651c0e9970f1e7064cba42c831583753f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Cut the memory the Codex PR-link scan needs on long chats: it keeps only the messages that can contain a PR link instead of every message.

- [#997](https://github.com/qlan-ro/mainframe/pull/997) [`3aa71ec`](https://github.com/qlan-ro/mainframe/commit/3aa71ecc955c09ad86ae37d7b34420fcbe0d6d53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open the last chat sooner after launch: the app asks for it as soon as the daemon answers, the daemon replies to the first resume before indexing the whole chat, and the adapter list and git reads no longer compete with the chat opening.

- [#1014](https://github.com/qlan-ro/mainframe/pull/1014) [`0fac516`](https://github.com/qlan-ro/mainframe/commit/0fac516b11678e2bb52db9a9959f39caf11e027c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Opening a chat the daemon has not cached (the first open after a start, an update or a turn it never saw) now shows the newest turns from the end of the transcript, or from Codex's turn pages, instead of reading the whole history first. The rest of the history still loads right after.

- [#928](https://github.com/qlan-ro/mainframe/pull/928) [`19ecfc3`](https://github.com/qlan-ro/mainframe/commit/19ecfc369c8c06dcdf01beb4fcbeba6c52611c72) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop a stalled GitHub request from leaving todo sync stuck as running, report GitHub's secondary rate limit as a rate limit instead of a credential failure, and keep the GitHub token from following pagination links off the API host.

- [#984](https://github.com/qlan-ro/mainframe/pull/984) [`54208b2`](https://github.com/qlan-ro/mainframe/commit/54208b26f8d22056913159213ab4d926ed51e8f9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reopen recently used chats faster after a restart: the daemon now refreshes a chat's saved history shortly after each turn and at shutdown, keeps plan and skill results with it, and caches Codex chats whose sub-agent transcripts are compressed.

- [#999](https://github.com/qlan-ro/mainframe/pull/999) [`4bddadb`](https://github.com/qlan-ro/mainframe/commit/4bddadb6cd691ffaf18ab1d26f8a433ec31d152c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - History windows are sized by whole turns. A chat opens on its last N turns and each older page adds N more, so the transcript never starts mid-turn. N is set in Settings, Chat, "Turns to load at a time" (default 10, 2 to 50). The daemon drops whole turns from the top of a window that would send more than about 1 MB. Requests without `turns` behave as before.

- [#937](https://github.com/qlan-ro/mainframe/pull/937) [`9adb26f`](https://github.com/qlan-ro/mainframe/commit/9adb26ff87933d160afd1b0cf9e959ee213d4539) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop a port tunnel request that the client abandons mid-start from blocking that port's tunnels until the daemon restarts. Stop a launch configuration from staying "starting" forever when its start request is dropped while the port is awaited, and stop opening a preview tunnel for a launch that was stopped or crashed before its port came up. Keep reading cloudflared's output after a non-UTF-8 log line instead of losing the tunnel. Reject a `launch.json` port outside 1–65535 instead of waiting on a truncated port, and stop a fast-exiting launch process from leaving a stale entry in the crash-recovery pidfile.

- [#1012](https://github.com/qlan-ro/mainframe/pull/1012) [`10abcba`](https://github.com/qlan-ro/mainframe/commit/10abcbadf1f1992b9cc81540ab0c271267385062) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The desktop window now opens straight away on launch instead of waiting up to 5 s for your login shell, and the "waiting for daemon" screen clears much sooner. The app reads your shell environment in the background and starts the daemon from the environment it saved on the previous launch. The daemon uses that environment instead of starting your shell a second time, so a slow shell profile no longer delays either of them. A daemon you start yourself (standalone or from the CLI) still reads your shell as before. Only what your shell profile adds is saved. Values Mainframe inherits from your login, such as the system SSH agent socket, come from the current session. An agent socket your profile sets itself (1Password, Secretive, gpg-agent) is kept, unless it no longer exists after a restart. If you edit a shell start-up file (`.zshrc`, `.zprofile`, `/etc/paths`, and so on), the next launch waits for a fresh read instead of using the saved one. Other changes to the environment reach the daemon on the following launch, and reach new terminals as soon as they are read.

- [#956](https://github.com/qlan-ro/mainframe/pull/956) [`3cfc624`](https://github.com/qlan-ro/mainframe/commit/3cfc6242e90a49537e1616d3ea2b40d2fb701118) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix delegated tasks and agent messages. A message to a chat whose CLI can't start is kept for its next turn instead of being retried in an endless loop. A delegation or delivery no longer stops halfway when the calling agent disconnects or cancels. Results dropped by a Stop stay dropped after a restart, and a database error no longer drops a result or ends a task. A stopped task is reported as interrupted even when its parent is waiting on it, and a task cancelled while it starts stays cancelled. Stopping an idle chat no longer blocks its agent's tools for the next turn.

- [#972](https://github.com/qlan-ro/mainframe/pull/972) [`668790d`](https://github.com/qlan-ro/mainframe/commit/668790d76fc0597aa280886e2d41995d757554ac) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep the desktop responsive while its daemon shuts down and log host, daemon and attributed WebKit memory usage.

- [#1001](https://github.com/qlan-ro/mainframe/pull/1001) [`853190d`](https://github.com/qlan-ro/mainframe/commit/853190d507e50e9bea4f328b316747e597756732) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The turn-end history refresh now parses with at most 2 workers, so a chat opened right after a turn ends no longer finds the shared parse budget spent and reads serially.

- [#936](https://github.com/qlan-ro/mainframe/pull/936) [`6f2c49f`](https://github.com/qlan-ro/mainframe/commit/6f2c49f24c332a7578e08af5c42511996549d4da) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop disabling or archiving a chat's worktree from deleting a directory that is not a linked worktree, such as the project checkout itself. Fix a file-watch race that could hang the daemon or silently stop file change events when a watch was shared or closed mid-change. Stop sending mobile pushes to tokens Expo reports as unregistered, give each push request a deadline, and stop the worktree backfill from making two projects each other's parent.

- [#1018](https://github.com/qlan-ro/mainframe/pull/1018) [`9e73d8c`](https://github.com/qlan-ro/mainframe/commit/9e73d8c53cf7154afe2d4004be0da3e605177aa0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Use less memory for open chats, most of all chats with images: the daemon keeps one copy of each image instead of one per internal history copy, and one copy of each displayed message instead of two.

- [#994](https://github.com/qlan-ro/mainframe/pull/994) [`abd524e`](https://github.com/qlan-ro/mainframe/commit/abd524ecf329786cdb0bb56c71d33998a68f3dd1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open a sub-agent tab faster: it fetches only its own tool call and its steps instead of paging the parent conversation back to it, and restoring a sub-agent tab on reload no longer loads parent history. The history request can now return an item's descendants.

- [#933](https://github.com/qlan-ro/mainframe/pull/933) [`6b906f6`](https://github.com/qlan-ro/mainframe/commit/6b906f6102d91235ef6b1d801728a3749279949d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Update the desktop shell to Tauri 2.12.

- [#1003](https://github.com/qlan-ro/mainframe/pull/1003) [`1d46c16`](https://github.com/qlan-ro/mainframe/commit/1d46c16673e31e1eab290181360b9e6e6387fdb0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The transcript jumps to the bottom only when a message really went out: a send into a chat whose working directory is gone, an empty send, a Send now that finds nothing to send and a failed Resume no longer move the view. Retry on a "Failed to send" message now jumps to the bottom like any other send.

- Updated dependencies [[`1ea1979`](https://github.com/qlan-ro/mainframe/commit/1ea19797234875cb0e003eae8c89e8868b457d5d), [`5f48ba9`](https://github.com/qlan-ro/mainframe/commit/5f48ba95d4af635e232d53d646b16e5598f55019), [`412c6ca`](https://github.com/qlan-ro/mainframe/commit/412c6cad802c04da39d613ddad1d1ccfad4fb058), [`2e85b7f`](https://github.com/qlan-ro/mainframe/commit/2e85b7ff10b76ffaca16373a2faba5d8a48b165c), [`0482f7e`](https://github.com/qlan-ro/mainframe/commit/0482f7eeea55f41b8d5f2de407ba0e69ac70224c), [`283176e`](https://github.com/qlan-ro/mainframe/commit/283176e083c72f2c8be06ba3487b51ae005d9978), [`68861ce`](https://github.com/qlan-ro/mainframe/commit/68861ce84eb5528041e4675b02f61a06d576f6a6), [`205e0d9`](https://github.com/qlan-ro/mainframe/commit/205e0d904e24b7df8e396faeacf8127f2a50fd1d), [`ebab8a4`](https://github.com/qlan-ro/mainframe/commit/ebab8a4a1f51f76c2160c5df0bb9679dd7bde856), [`3aa71ec`](https://github.com/qlan-ro/mainframe/commit/3aa71ecc955c09ad86ae37d7b34420fcbe0d6d53), [`e65ea9b`](https://github.com/qlan-ro/mainframe/commit/e65ea9ba81bb03e98045579f37577353db4dae3e), [`deade40`](https://github.com/qlan-ro/mainframe/commit/deade407943cda0d54a35dea341f214c8c92823f), [`4bddadb`](https://github.com/qlan-ro/mainframe/commit/4bddadb6cd691ffaf18ab1d26f8a433ec31d152c), [`9c67a4e`](https://github.com/qlan-ro/mainframe/commit/9c67a4eeaf36595d0cc55a8f1b75de8974a8f043), [`8cb9342`](https://github.com/qlan-ro/mainframe/commit/8cb9342290ac1fef00feb9579d0cd767245edf4a), [`9a19211`](https://github.com/qlan-ro/mainframe/commit/9a1921188efaec373708b96515f84964f0ad405c), [`874cdfd`](https://github.com/qlan-ro/mainframe/commit/874cdfd0eded7e031b3df42c003b3d141d4eab44), [`a4da0b0`](https://github.com/qlan-ro/mainframe/commit/a4da0b060d669fc17be95752ef8c8aa2502c5df4), [`0ddf245`](https://github.com/qlan-ro/mainframe/commit/0ddf245643731b9d3548bb9079a6e047420e7db5), [`72caea5`](https://github.com/qlan-ro/mainframe/commit/72caea55893ed66d91204b42e3cfb4366fb3a7b4), [`33a906d`](https://github.com/qlan-ro/mainframe/commit/33a906d5790e132c373d43fcefc2b7190a560885), [`b7f0fd4`](https://github.com/qlan-ro/mainframe/commit/b7f0fd49d58692efb1fbecf707f9292bac8b4c8b), [`4231b4a`](https://github.com/qlan-ro/mainframe/commit/4231b4a623829b48fcbbb4a3c6eddea896925fcd), [`0e0a297`](https://github.com/qlan-ro/mainframe/commit/0e0a29760dedb3685af09e310986501bea179fc4), [`76e2d12`](https://github.com/qlan-ro/mainframe/commit/76e2d1262ab0b623998747fa9606aecd0d266467), [`04d923f`](https://github.com/qlan-ro/mainframe/commit/04d923ff0c9613a887c04cc9ffb592c3f4b20b6d), [`3724775`](https://github.com/qlan-ro/mainframe/commit/3724775b16b9e983ec6241ce800c71ddabd78c33), [`92aa1d2`](https://github.com/qlan-ro/mainframe/commit/92aa1d2a48273bd7ff9d44852dce44633a51de15), [`0ab667e`](https://github.com/qlan-ro/mainframe/commit/0ab667e4a7c7d40b7bb23c5c145088792d999e95), [`3f1cb14`](https://github.com/qlan-ro/mainframe/commit/3f1cb14f07b3531f4f6c794c36d439e66d670004), [`320e396`](https://github.com/qlan-ro/mainframe/commit/320e3962060077c7d6626675edde383456a24b31), [`9bbd816`](https://github.com/qlan-ro/mainframe/commit/9bbd816975579c954ab2d03cff199d2158201ba1), [`38640de`](https://github.com/qlan-ro/mainframe/commit/38640de9fca8fb8892623596269ea6a41dba2aa7), [`7de33a7`](https://github.com/qlan-ro/mainframe/commit/7de33a7418e4773e4614cc173a07f4c9310fe032), [`5457605`](https://github.com/qlan-ro/mainframe/commit/545760530e6929d699f305dcf959ed244fd6119e), [`60dd51a`](https://github.com/qlan-ro/mainframe/commit/60dd51a800cd139b167cdfdf32abc0ef94e96ee2), [`8559634`](https://github.com/qlan-ro/mainframe/commit/85596345e5db970266784886370c62b7c99f1355), [`0769118`](https://github.com/qlan-ro/mainframe/commit/07691181b9eef76e051fb7963af96f66d7546aab), [`726858f`](https://github.com/qlan-ro/mainframe/commit/726858f15f26e25b7d5661153c3e1090f8a8bd2c), [`f31d7f8`](https://github.com/qlan-ro/mainframe/commit/f31d7f802f239c8af364346ff8381150b5b1abd0), [`38640de`](https://github.com/qlan-ro/mainframe/commit/38640de9fca8fb8892623596269ea6a41dba2aa7), [`210adeb`](https://github.com/qlan-ro/mainframe/commit/210adeb92391e04088195c3fd36d9ec91cdaaae5), [`bfc3f2e`](https://github.com/qlan-ro/mainframe/commit/bfc3f2e8367c6037e53607bb24e84a56270d695d), [`acf8463`](https://github.com/qlan-ro/mainframe/commit/acf84635bc301118100c4613d15a21291950a917), [`9ec306d`](https://github.com/qlan-ro/mainframe/commit/9ec306d9ad01c89195e422374c6c4bbe2c1991ce), [`ab16bd6`](https://github.com/qlan-ro/mainframe/commit/ab16bd66a6f105d423b8db561a003506d2d7fcfd)]:
  - @qlan-ro/mainframe-ui@2.17.0

## 2.4.0

### Minor Changes

- [#922](https://github.com/qlan-ro/mainframe/pull/922) [`0d9af35`](https://github.com/qlan-ro/mainframe/commit/0d9af357a7432986576b91ee9b3284ebf895e936) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Connect local MCP clients to selected projects with revocable credentials and read-only or chat-control access. Manage clients in Settings, choose a maximum permission level, and let external clients read, launch, message, stop, or configure chats.

### Patch Changes

- [#914](https://github.com/qlan-ro/mainframe/pull/914) [`c358e55`](https://github.com/qlan-ro/mainframe/commit/c358e55b54b6f17d22d4090bf0670215476d04ee) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix missing final answers after tool calls, including replay of existing chats after compaction. Give transcript items separate stable identities and preserve native tool references for result expansion.

- [#919](https://github.com/qlan-ro/mainframe/pull/919) [`a68e751`](https://github.com/qlan-ro/mainframe/commit/a68e75129c2fb5b287d22283d5a7c0064096962d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop a background task from being reported as ended twice when the CLI's notification races the liveness sweep or a kill.

- [#909](https://github.com/qlan-ro/mainframe/pull/909) [`223a96f`](https://github.com/qlan-ro/mainframe/commit/223a96f3fb13ff6ef9bc7ef94836178f36ef8bba) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep Claude proxy model diagnostics and connector warnings from marking an active chat as failed or hiding compaction progress. Show connector availability as a short transcript notice.

- [#925](https://github.com/qlan-ro/mainframe/pull/925) [`7f216cd`](https://github.com/qlan-ro/mainframe/commit/7f216cde73591601fbb8f0ebc0677b7841318b08) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep editor language features working after the editor reconnects, and let idle language servers actually stop.

- Updated dependencies [[`1879723`](https://github.com/qlan-ro/mainframe/commit/187972381c4d539fc88a07579126e498c0393355), [`d5b3207`](https://github.com/qlan-ro/mainframe/commit/d5b320755ad40d8bea65a03ff281290fd1c24d29)]:
  - @qlan-ro/mainframe-ui@2.16.0

## 2.3.10

### Patch Changes

- [#898](https://github.com/qlan-ro/mainframe/pull/898) [`0a18c70`](https://github.com/qlan-ro/mainframe/commit/0a18c70253784973268f63b6711f641fcef143dd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Close pending Codex approval and question cards when the server withdraws their requests, without sending a stale reply.

- Updated dependencies [[`17b6701`](https://github.com/qlan-ro/mainframe/commit/17b6701512fc0de0bb7afd2d7489b540ceab3cc1), [`5ccc00f`](https://github.com/qlan-ro/mainframe/commit/5ccc00fbc49f0fa76f339e8aaa2e5885f3f6d83d), [`3b56cda`](https://github.com/qlan-ro/mainframe/commit/3b56cda55305bc431f970a6d4b753f96b02b64b3), [`9df004a`](https://github.com/qlan-ro/mainframe/commit/9df004adb8c3eda727f6b60f764be905da3f764e), [`49be5bb`](https://github.com/qlan-ro/mainframe/commit/49be5bb914500206ad90d3cb81caf40ebb0a1e7a), [`3cbdb43`](https://github.com/qlan-ro/mainframe/commit/3cbdb4340d14160e26fe962b7268fbf813439722), [`b20f932`](https://github.com/qlan-ro/mainframe/commit/b20f932f77dab33b74637c0e01a19c8640475baa), [`b9b257c`](https://github.com/qlan-ro/mainframe/commit/b9b257cf3dd2db3e454050e88e8bb9a9838f285d), [`57dd00a`](https://github.com/qlan-ro/mainframe/commit/57dd00a8f81f991acf562e41e0e437cf316f940d), [`3921ca1`](https://github.com/qlan-ro/mainframe/commit/3921ca159f1392a5a0070e3be23e81878490c8a5), [`fdac402`](https://github.com/qlan-ro/mainframe/commit/fdac402ee425172f8b074af9c35948972ee72acb)]:
  - @qlan-ro/mainframe-ui@2.15.0

## 2.3.9

### Patch Changes

- [#888](https://github.com/qlan-ro/mainframe/pull/888) [`86fd1b5`](https://github.com/qlan-ro/mainframe/commit/86fd1b515e10a957f1554cfb4fac1c42892a4972) Thanks [@doruchiulan](https://github.com/doruchiulan)! - If a message can't start a turn, the chat no longer stays stuck as working. The message shows as failed, with the actual reason and a Retry option. When the cause is a Codex thread that was archived in Codex, the failed message also has an Unarchive button: it unarchives the thread and sends the message again, so you don't need to open the Codex app.

- [#886](https://github.com/qlan-ro/mainframe/pull/886) [`11de55e`](https://github.com/qlan-ro/mainframe/commit/11de55e654791debe38bd8117a20272b1baa36b4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `~/.mainframe/config.json`, which holds the device auth secret and tunnel token, is now readable only by your user, and existing files are tightened at the next daemon start. Removing a named tunnel in Settings now deletes its saved token and URL. Saving settings no longer writes environment overrides such as `TUNNEL_TOKEN` to disk, keeps keys it does not recognise, and moves an unreadable config aside as `config.json.invalid.<timestamp>` instead of overwriting it. Trusting a workspace no longer widens the permissions of `~/.claude.json`. The daemon finds your `PATH` when shell start-up files print a banner and no longer hangs at start-up on a stuck shell. Automation `run_command` steps finish when a background job outlives the script, and the job keeps running, and Codex and CLI updates keep running after a non-UTF-8 output line.

- Updated dependencies [[`024caae`](https://github.com/qlan-ro/mainframe/commit/024caae520817cdb220816f6e972ba192bc17a9a)]:
  - @qlan-ro/mainframe-ui@2.14.0

## 2.3.8

### Patch Changes

- [#880](https://github.com/qlan-ro/mainframe/pull/880) [`764e4b8`](https://github.com/qlan-ro/mainframe/commit/764e4b81173dca2bb85cea52f2d61d6244c85fed) Thanks [@doruchiulan](https://github.com/doruchiulan)! - An automation's Ask agent step with a fixed worktree branch now runs again after its first run instead of failing with "a branch named … already exists". It continues in the worktree that has the branch checked out, or checks the existing branch out into a new worktree.

- Updated dependencies [[`b433082`](https://github.com/qlan-ro/mainframe/commit/b43308210a2e190c191d063a97e9583d03613af7)]:
  - @qlan-ro/mainframe-ui@2.13.0

## 2.3.7

### Patch Changes

- Updated dependencies [[`208ca81`](https://github.com/qlan-ro/mainframe/commit/208ca81bf1a0f3d0955d3e27f34aa524ba2836d1), [`b9f32b3`](https://github.com/qlan-ro/mainframe/commit/b9f32b3581f9e15dd4be8af5e6aca6124b20f4c7), [`6ea55df`](https://github.com/qlan-ro/mainframe/commit/6ea55dfeb584a181fc7ac0dd5970e7f14fae9e6d)]:
  - @qlan-ro/mainframe-ui@2.12.5

## 2.3.6

### Patch Changes

- Updated dependencies [[`580495e`](https://github.com/qlan-ro/mainframe/commit/580495ee8fa7ce86cf81b2a86fbccce7a2d3f5d3), [`c1fa157`](https://github.com/qlan-ro/mainframe/commit/c1fa157ece9e955824ba6d5d417f9e75570bc9f4), [`de42046`](https://github.com/qlan-ro/mainframe/commit/de4204619f74d0b201ff741cb50cf609f745de63), [`1af004d`](https://github.com/qlan-ro/mainframe/commit/1af004daa70ecae6e681eccc1a29de64652eafea)]:
  - @qlan-ro/mainframe-ui@2.12.4

## 2.3.5

### Patch Changes

- Updated dependencies [[`7435f8e`](https://github.com/qlan-ro/mainframe/commit/7435f8e6c496dd93374754be13f064cf376b140e), [`b1cc1ba`](https://github.com/qlan-ro/mainframe/commit/b1cc1ba06743a31d7a5567aa0ab09339d0c2d7ee)]:
  - @qlan-ro/mainframe-ui@2.12.3

## 2.3.4

### Patch Changes

- [#861](https://github.com/qlan-ro/mainframe/pull/861) [`459500d`](https://github.com/qlan-ro/mainframe/commit/459500de39267ebff81765500ecc379cee17e0cf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Aborting a merge or rebase from the branch menu now works in a project's main checkout, the branch list shows the merge or rebase in progress there, and a rebase that stops on conflicts reports them instead of failing. Committing with no changes now says "Nothing to commit". Branch and remote names that look like git options are passed to git as names, never as options.

- Updated dependencies [[`02a46d9`](https://github.com/qlan-ro/mainframe/commit/02a46d9a23f1535dae0a983f1c54f76b0e676a86)]:
  - @qlan-ro/mainframe-ui@2.12.2

## 2.3.3

### Patch Changes

- Updated dependencies [[`3d14767`](https://github.com/qlan-ro/mainframe/commit/3d14767ea72127e3dee26eb74c0a7d48c4b8ae41), [`eb3df82`](https://github.com/qlan-ro/mainframe/commit/eb3df82b5a00efc93a695e0ec39ee366c814124b), [`38e20a9`](https://github.com/qlan-ro/mainframe/commit/38e20a97b30b1a8bd41b33cfac116695f82d1dcb), [`23991c6`](https://github.com/qlan-ro/mainframe/commit/23991c61d32b05a62b9865d8031ef963f545467b), [`257f7a0`](https://github.com/qlan-ro/mainframe/commit/257f7a01049ba757eb9b040d3df8c987c6719b32)]:
  - @qlan-ro/mainframe-ui@2.12.1

## 2.3.2

### Patch Changes

- [#847](https://github.com/qlan-ro/mainframe/pull/847) [`851d617`](https://github.com/qlan-ro/mainframe/commit/851d61787f5fb6915328e8f8a538bf28bc5c953a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - A Codex usage limit that Codex stops reporting (for example the 5-hour window after a plan change) no longer stays on screen at its last value. Codex snapshots now replace the stored limits, Refresh clears a dropped one, and limits from Codex's other metered buckets no longer overwrite the plan's.

- Updated dependencies [[`e35d109`](https://github.com/qlan-ro/mainframe/commit/e35d109ed9b9f46df6e105ca37eb6f5a2b96d859), [`851d617`](https://github.com/qlan-ro/mainframe/commit/851d61787f5fb6915328e8f8a538bf28bc5c953a)]:
  - @qlan-ro/mainframe-ui@2.12.0

## 2.3.1

### Patch Changes

- [#844](https://github.com/qlan-ro/mainframe/pull/844) [`92d5b7c`](https://github.com/qlan-ro/mainframe/commit/92d5b7cf955acb5c18b5b6c98f816ea6b04bdd66) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Claude models show their names again (for example "Opus 5.5") in the model picker with Claude Code 2.1.302 and later, instead of their taglines.

- Updated dependencies [[`9255a1a`](https://github.com/qlan-ro/mainframe/commit/9255a1a409e02822a50a5f96d7d411a9ac02efc6)]:
  - @qlan-ro/mainframe-ui@2.11.1

## 2.3.0

### Minor Changes

- [#842](https://github.com/qlan-ro/mainframe/pull/842) [`fbde27f`](https://github.com/qlan-ro/mainframe/commit/fbde27ff17d90cabf83e495439027663bf3755aa) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a Reveal in Finder button to every file preview tab, including files outside the project. HTML files now open with a Preview/Source toggle and an Open in browser button. The PDF and unsupported-file "Open externally" buttons now open the file in its default app.

- [#841](https://github.com/qlan-ro/mainframe/pull/841) [`6395e48`](https://github.com/qlan-ro/mainframe/commit/6395e487e0276f1a03586a7d55a43aaedae83575) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Settings → Providers now shows the installed and latest version of the Claude Code and Codex CLIs, and can update them in place. Mainframe works out how each CLI was installed (Homebrew, npm, pnpm, Bun, or Claude Code's native installer) and runs the matching upgrade on the daemon host, showing its output as it goes. When the install method is unknown, or the update fails on permissions, it shows the command to run in a terminal. After an update the provider's model list refreshes without restarting Mainframe; running sessions keep the previous version until they restart. Available updates also show on the update button in the left rail, next to Mainframe's own: it lists every pending update and can start each one, and a dot next to each provider in Settings marks which have one. Version checks run in the background every few hours and stay quiet when offline.

### Patch Changes

- [#834](https://github.com/qlan-ro/mainframe/pull/834) [`0fc7eac`](https://github.com/qlan-ro/mainframe/commit/0fc7eac85a5bf878ab1648191a08f5e69d1dd680) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex errors from OpenAI now read as plain sentences instead of raw JSON. When Codex rejects every model because the ChatGPT subscription ended, the error says when it ended and asks you to renew and run `codex logout && codex login`. Rate limits, login failures, context-length overflows and OpenAI outages each say what to do next, and any other OpenAI error shows OpenAI's message with its status code.

- [#831](https://github.com/qlan-ro/mainframe/pull/831) [`48d7e42`](https://github.com/qlan-ro/mainframe/commit/48d7e4262090bf1d75578e4782201cb4d85ea802) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reloaded Claude chats keep each reply to a hidden prompt, such as a background-task notification, on its own line instead of running it into the previous reply. Codex history likewise keeps replies from different turns apart when no user message separates them.

  Late tool results remain attached to their original calls across turn boundaries, and streaming updates preserve the same reply containers as reloaded history.

- [#839](https://github.com/qlan-ro/mainframe/pull/839) [`3370b36`](https://github.com/qlan-ro/mainframe/commit/3370b365fd304daacb919fd928a7e68e770cdf82) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix the Review panel's change scopes. Branch now diffs each file against the branch's merge base instead of HEAD, so changes already committed on the branch show up, and renamed files read their original from the old path. Session now lists every file the session wrote or edited, committed or not, marked added, modified or deleted, and diffs each one from the session's own edits. When later work stops those edits from replaying, the diff compares the file with the last commit before the session started and says so. Switching scopes no longer opens the previous scope's first file. Uncommitted now lists new files inside new directories. Scopes that report no line counts no longer show `+0 −0`.

- Updated dependencies [[`4a49009`](https://github.com/qlan-ro/mainframe/commit/4a490092925d9561d02a47c5bda98d920b989d9b), [`0d32eae`](https://github.com/qlan-ro/mainframe/commit/0d32eaea63eb1253277fb428157edf4a39238ddc), [`6fd747a`](https://github.com/qlan-ro/mainframe/commit/6fd747a3edd87cee26c86c3df10ddca9bb1b9034), [`fbde27f`](https://github.com/qlan-ro/mainframe/commit/fbde27ff17d90cabf83e495439027663bf3755aa), [`6395e48`](https://github.com/qlan-ro/mainframe/commit/6395e487e0276f1a03586a7d55a43aaedae83575), [`3370b36`](https://github.com/qlan-ro/mainframe/commit/3370b365fd304daacb919fd928a7e68e770cdf82), [`6e736ce`](https://github.com/qlan-ro/mainframe/commit/6e736cea8ec49dae48165d28e43b6c2cf5368cc2), [`6fc4cb8`](https://github.com/qlan-ro/mainframe/commit/6fc4cb87e4932f24af6cca14a5bb1f4be1d22da6), [`9e18ed7`](https://github.com/qlan-ro/mainframe/commit/9e18ed736dd3bcb29abe6f099cf7c4661ca41245), [`04d1f18`](https://github.com/qlan-ro/mainframe/commit/04d1f18ef1d3b99d12e3d1d0a1f2fbfcf8b79ed8)]:
  - @qlan-ro/mainframe-ui@2.11.0

## 2.2.10

### Patch Changes

- Updated dependencies [[`1bec111`](https://github.com/qlan-ro/mainframe/commit/1bec11112ff7d373974a5571797f5a5fca5b73c1), [`cdde79a`](https://github.com/qlan-ro/mainframe/commit/cdde79a21b6b7e5e4cab0d1804e644bb3adb4ef7), [`1ac8410`](https://github.com/qlan-ro/mainframe/commit/1ac84108714aec8f416af38d728e65bca5269939), [`801c1fc`](https://github.com/qlan-ro/mainframe/commit/801c1fc1bb3179df4dcf97a2bdbce19d9eaceb02)]:
  - @qlan-ro/mainframe-ui@2.10.0

## 2.2.9

### Patch Changes

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The automation run view now refreshes as soon as an agent step fails on its deadline, the same way it does when the agent itself fails.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Automations now fill in `$name` variables inside Loop, Retry and Parallel blocks. Before, steps there showed the literal `$name` text instead of the value.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Quitting the desktop app now gives the daemon up to 10 seconds to shut down cleanly instead of killing it at once. While shutting down, and whenever a tunnel or Run-panel preview is stopped, the daemon waits for the cloudflared process to exit, including tunnels still starting, and force-kills any that ignore the stop request after 2 seconds. Language servers get the same fallback.

  Child cleanup starts when shutdown is requested, even if a tunnel-start request is still waiting for registration or DNS. New launch, tunnel, and language-server starts are rejected during shutdown. Pending language-server discovery is cancelled without delaying shutdown.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Newly created and forked chats now carry the same fields as later updates to them, so a chat looks the same to the app before and after its first update.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Forking a chat to a worktree now keeps its `acceptEdits` permission mode.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep chat completion, send, and teardown events flowing when storage fails, and restart chats on failed worktree or configuration changes. Report a created worktree's path when attaching it fails; keep notifications ordered with the turn that produced them.

  Stop launches and tunnels before deleting worktrees, including unbound path aliases, then publish status from the live chat. Imported chat creation and title updates now both include display status, running state, and missing-directory fields. Chat list/get requests return 500 on storage failure, failed creation returns an error instead of a stub, and fork snapshot cleanup stops on a database failure.

  Cache notification preferences at boot and refresh them after general settings updates. Keep accepted live settings, working state, plan mode, and generated titles visible during storage failures. If a worktree binding write fails after moving a Claude transcript, restart with the new live binding so resume uses the moved transcript.

- [#784](https://github.com/qlan-ro/mainframe/pull/784) [`4f0046b`](https://github.com/qlan-ro/mainframe/commit/4f0046b62124b8b859a3f06623d6eb76ca72dc3a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex's Default permission mode no longer asks before every command. Reads and searches now run without a prompt inside a read-only sandbox, while edits, commands that write, and network access still ask first. Before, Default asked about almost every command and "Accept for session" rarely stuck, because it only remembers that exact command. Delegated tasks also inherit the parent chat's permission mode unless the agent deliberately picks a stricter one, so a task started from an Unattended chat no longer floods you with approval prompts.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex chats no longer store a Claude transcript path. Claude chats keep their existing transcript path.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The configured `dataDir` now applies to the database and to both the daemon's and the desktop app's logs. An existing database in the previous default location moves to the configured directory on startup, including to another volume; if the move fails, Mainframe keeps using the existing database and tries again on the next start.

  Startup claims the daemon port before opening the database, and migration retains SQLite exclusion until the move finishes so another connection cannot write during relocation.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Settings reads go through one shared contract. A damaged stored value (an unknown update channel, a malformed notification group) is reported with its safe default and logged instead of failing silently, and a notification update with a null value is rejected with a 400 instead of being ignored.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Daemon errors now answer with the right HTTP status: a missing chat or project is a 404 instead of a 400 or 500, a refused request such as deleting the hidden scratch project or an invalid attachment chat id is a 400, a busy chat is a 409, and internal failures while moving a chat into a worktree (transcript move, adapter, disk) are 500s instead of 400s. Unexpected storage failures no longer leak database text in tag responses. Error messages are unchanged.

- [#786](https://github.com/qlan-ro/mainframe/pull/786) [`d3e4516`](https://github.com/qlan-ro/mainframe/commit/d3e4516eeebefcb98b82fbec3efd1375ee6b5743) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Asking an agent to "spawn a Codex agent" or "ask Claude to" do something now starts a Mainframe task you can see, instead of a Claude Code plugin's hidden subagent. Delegated task results and other messages from agents now show as full-width cards on the left, like assistant replies, not on the right like your own messages. Their headers show the chat's title instead of a raw chat id. A delegated task's "Delegated by" link no longer reads "Untitled session" for a parent chat started in the same app session.

- [#820](https://github.com/qlan-ro/mainframe/pull/820) [`6e0f573`](https://github.com/qlan-ro/mainframe/commit/6e0f5731bf4d349ce3d50736104dd2aef9dbb092) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Delegated tasks now appear in the parent chat's Activity panel with their current status and a link to the child chat. The parent session stays marked as working while a delegated task runs, including after the parent's own turn ends.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Moving a running chat into a new worktree no longer leaves the chat stopped when its session history cannot be moved; the chat restarts where it was and the error is shown.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Creating or forking a chat, opening a side chat and deleting a todo now either complete fully or leave nothing behind. Todo attachment ids must be a single safe file name, and a damaged value stored in a chat, todo or tag column is logged and shown with a safe default instead of failing the whole list; todo statuses, types and priorities written by other tools are kept as they are.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Return not-found responses for missing chat/project inputs and deleted chat worktrees. Report plugin storage failures instead of returning empty or unpersisted results.

  Preserve workflow history and Run panel controls after a worktree is deleted. Deleting a worktree now stops its launch processes and preview tunnels.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Consolidate daemon process handling into one module: Codex app-server shutdown now asks politely (SIGTERM, 800 ms) before SIGKILL, CLI exits are reported only after their last output was delivered, and writes to a CLI that stopped reading its stdin fail instead of buffering without limit (a Codex approval reply that cannot be delivered now shows as an error). Restarting a launch config right after it exits no longer marks the new process stopped or closes its preview tunnel, and an LSP server that stopped reading its input is still shut down.

- [#812](https://github.com/qlan-ro/mainframe/pull/812) [`2463aef`](https://github.com/qlan-ro/mainframe/commit/2463aefc3dd59fc072a8efe7f8b360a3aa13666a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - When chat title generation fails, the daemon log now shows what the Claude CLI printed (for example "Not logged in" or a usage-limit notice) instead of "<no stderr>".

- Updated dependencies [[`8d026ac`](https://github.com/qlan-ro/mainframe/commit/8d026ac714f54b99072b2b4b16b64859afa5dc6e), [`4f0046b`](https://github.com/qlan-ro/mainframe/commit/4f0046b62124b8b859a3f06623d6eb76ca72dc3a), [`d3e4516`](https://github.com/qlan-ro/mainframe/commit/d3e4516eeebefcb98b82fbec3efd1375ee6b5743), [`6e0f573`](https://github.com/qlan-ro/mainframe/commit/6e0f5731bf4d349ce3d50736104dd2aef9dbb092), [`1fb8e87`](https://github.com/qlan-ro/mainframe/commit/1fb8e87fe1a32fa899b944aa6c0351c4de53f180), [`5466ea6`](https://github.com/qlan-ro/mainframe/commit/5466ea6bcb38c809983aa3d3a44ee7a6ee377d1b)]:
  - @qlan-ro/mainframe-ui@2.9.0

## 2.2.8

### Patch Changes

- [#772](https://github.com/qlan-ro/mainframe/pull/772) [`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex's Default permission mode now asks before every edit and every command, matching what "Interactive" already promises in the permission menu. It used to edit files and run commands without asking, just like Accept Edits. Existing Codex chats left in Default mode will start seeing approval prompts; pick Accept Edits for the old auto-edit behavior. This also lets a Claude chat in Default mode delegate to a Codex chat, since both now carry the same real privilege.

- Updated dependencies [[`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c), [`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c), [`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c), [`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c), [`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c), [`1bea6f0`](https://github.com/qlan-ro/mainframe/commit/1bea6f060be230257a163787e290a98c34e59f8c)]:
  - @qlan-ro/mainframe-ui@2.8.0

## 2.2.7

### Patch Changes

- Updated dependencies [[`e555846`](https://github.com/qlan-ro/mainframe/commit/e555846e431243b6c0739efbdc964847d75a26be), [`068b588`](https://github.com/qlan-ro/mainframe/commit/068b58865965328d92eb6c2ad1a875c95dfc3705), [`2e36c0d`](https://github.com/qlan-ro/mainframe/commit/2e36c0d3b5c0837a05b62c8d59d5481377ab8572), [`372508d`](https://github.com/qlan-ro/mainframe/commit/372508d4a318ca52c1a51b4c054ab38c9ecde4e3), [`af59284`](https://github.com/qlan-ro/mainframe/commit/af592849b2f5b6ef7a29210f934ef344086f74df)]:
  - @qlan-ro/mainframe-ui@2.7.2

## 2.2.6

### Patch Changes

- Updated dependencies [[`640c3be`](https://github.com/qlan-ro/mainframe/commit/640c3becdb0422f353981fc307fc90f9a21112b0)]:
  - @qlan-ro/mainframe-ui@2.7.1

## 2.2.5

### Patch Changes

- Updated dependencies [[`976d347`](https://github.com/qlan-ro/mainframe/commit/976d347c0745f88b8f7a6daefc7f57acba52bebc)]:
  - @qlan-ro/mainframe-ui@2.7.0

## 2.2.4

### Patch Changes

- Updated dependencies [[`f50f0d4`](https://github.com/qlan-ro/mainframe/commit/f50f0d40cb8ec3fffffb167468df85744a885c99), [`b9db838`](https://github.com/qlan-ro/mainframe/commit/b9db838926ebc3a2c63382db60cedbedef63f9f3), [`59df276`](https://github.com/qlan-ro/mainframe/commit/59df27603b5bbdd4c4ead3ca58c78a5ea73c32ff), [`b9db838`](https://github.com/qlan-ro/mainframe/commit/b9db838926ebc3a2c63382db60cedbedef63f9f3), [`9932c25`](https://github.com/qlan-ro/mainframe/commit/9932c25e2fad32d128acc64d8179939401e072f3)]:
  - @qlan-ro/mainframe-ui@2.6.2

## 2.2.3

### Patch Changes

- [#757](https://github.com/qlan-ro/mainframe/pull/757) [`8684aa5`](https://github.com/qlan-ro/mainframe/commit/8684aa51f75c2bf95d3ece2e96a8a25ec99591b9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix new chats showing no transcript at all. A session resume that read the display snapshot before the chat's first prompt seeded the incremental display projector with empty history; every message appended afterward was then silently skipped instead of being folded into the chat, so the daemon never sent any transcript items.

- Updated dependencies [[`2f933a8`](https://github.com/qlan-ro/mainframe/commit/2f933a8ecabfa64cd13e27d5d946dcde241330b2)]:
  - @qlan-ro/mainframe-ui@2.6.1

## 2.2.2

### Patch Changes

- [#753](https://github.com/qlan-ro/mainframe/pull/753) [`b20f3c0`](https://github.com/qlan-ro/mainframe/commit/b20f3c081609f462c6673b33aab712ffb864500f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - An ordinary streaming update now costs work proportional to the active turn and the containers it touches, not to a chat's settled history length. Each chat keeps a stateful display projector that turns a raw-cache mutation plus the live partial overlay into a container-level delta, and the ACP facade hub encodes, diffs, and records only the changed containers instead of re-encoding and re-diffing the whole transcript on every partial. Full history load, an explicit transcript replacement, and resume replay are unaffected and still produce a full snapshot; the wire protocol and resume-cursor behavior are unchanged.

- [#749](https://github.com/qlan-ro/mainframe/pull/749) [`94dbd98`](https://github.com/qlan-ro/mainframe/commit/94dbd98fb680657ea564348be066939f835f1d67) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix a chat that was created but never sent, a failed spawn, or a REST `/resume` that never started keeping its cached message history and registry slot pinned in memory indefinitely. These unspawned chats now become eligible for the same idle offload spawned sessions already get, releasing their cache and registry cell after the normal idle threshold while leaving the chat and its transcript intact for the next load or send.

- Updated dependencies [[`e128085`](https://github.com/qlan-ro/mainframe/commit/e12808556ac959912fa162bf0382a1be3db49947), [`08590a2`](https://github.com/qlan-ro/mainframe/commit/08590a2fc9125678f34b52a023ab798795c5e01b), [`e6af2bf`](https://github.com/qlan-ro/mainframe/commit/e6af2bfa381750702f750605c95f3d4dbbbb44eb), [`3aef705`](https://github.com/qlan-ro/mainframe/commit/3aef70599f909b529eae5394287e4dda1a047fef), [`f6cf803`](https://github.com/qlan-ro/mainframe/commit/f6cf803d2aa8e5213042af7d4352e4c0168c0113), [`f60b797`](https://github.com/qlan-ro/mainframe/commit/f60b797c0130dde91c15b673089e219120c137c3), [`88d633c`](https://github.com/qlan-ro/mainframe/commit/88d633cbb33e20b8da9a4d84dd8cff8c7b3d79f3), [`54a31fb`](https://github.com/qlan-ro/mainframe/commit/54a31fbbcdfdf26c78a377f1830affdf6cb416da), [`4f82774`](https://github.com/qlan-ro/mainframe/commit/4f82774d99c10f583ba28c44ccf73af116e0ca76), [`8145d30`](https://github.com/qlan-ro/mainframe/commit/8145d3051b656a7fe5df7bc3fcb02ba3052376f9), [`3831add`](https://github.com/qlan-ro/mainframe/commit/3831add8548e86b1872ecacff5f1527bde24b439), [`8326219`](https://github.com/qlan-ro/mainframe/commit/83262198f29e426ccd408ca3f879371b001e8437), [`e3730c8`](https://github.com/qlan-ro/mainframe/commit/e3730c8e51bffb0249938010d67f86ac0f3181d8), [`d1b5d72`](https://github.com/qlan-ro/mainframe/commit/d1b5d721f19eab8f0e8356d6b75b749984d672cc), [`ba53b7b`](https://github.com/qlan-ro/mainframe/commit/ba53b7b4363ae48ff8c36d0e9adc4f7a3d0b9c7b), [`08590a2`](https://github.com/qlan-ro/mainframe/commit/08590a2fc9125678f34b52a023ab798795c5e01b), [`0ea3eb8`](https://github.com/qlan-ro/mainframe/commit/0ea3eb85d956abb2e126561970ee54337a8f918e), [`488b79c`](https://github.com/qlan-ro/mainframe/commit/488b79cbcc31a0f1e29aff5210d4583baefe3a02), [`4be487f`](https://github.com/qlan-ro/mainframe/commit/4be487f95e41ab0d59d9d890461626f2289016b8)]:
  - @qlan-ro/mainframe-ui@2.6.0

## 2.2.1

### Patch Changes

- Updated dependencies [[`d10242a`](https://github.com/qlan-ro/mainframe/commit/d10242ae502717bb504c292feaa3d13956b158a0)]:
  - @qlan-ro/mainframe-ui@2.5.1

## 2.2.0

### Minor Changes

- [#723](https://github.com/qlan-ro/mainframe/pull/723) [`42247b2`](https://github.com/qlan-ro/mainframe/commit/42247b286a41e12d8c0cbc988d0ed19e48fe1c0c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex chats can now fork through the same Fork menu item, REST route and `parentChatId` lineage [#343](https://github.com/qlan-ro/mainframe/issues/343) built for Claude ([#368](https://github.com/qlan-ro/mainframe/issues/368)). Forking calls the app-server's `thread/fork` RPC with the parent's thread id and its last completed turn, so the new chat inherits the parent's history up to the fork point while the parent's own thread and turns stay untouched; the new thread's `forkedFromId` records the lineage. The capability is version-gated on Codex CLI 0.143.0 or newer (the first release with `thread/fork`'s turn-level pinning) — on an older CLI the Fork menu item and the REST route's 422 both show a version-specific reason instead of the generic "isn't available" copy, and the adapter registry now recomputes capabilities after every refresh so the UI never gets stuck on a stale pre-refresh snapshot.

- [#726](https://github.com/qlan-ro/mainframe/pull/726) [`3b3f733`](https://github.com/qlan-ro/mainframe/commit/3b3f733836c9092148a7b095041c97d5d1839be4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Adds daemon support for side chats ([#344](https://github.com/qlan-ro/mainframe/issues/344)): a temporary, parented chat opened from any chat's own project, adapter and working directory, always empty and never listed as a session. `POST /api/chats/{id}/side-chat` opens or reveals a parent's one side chat; discarding it, archiving its parent, or removing its parent's project all tear it down. When the parent's adapter reports the no-persistence capability, the side chat's spawn carries that option through the existing temporary-chat spawn seam ([#346](https://github.com/qlan-ro/mainframe/issues/346)) with no new adapter code — after a daemon restart its row and parent relationship survive but its conversation does not, and the next message starts a fresh vendor session.

### Patch Changes

- Updated dependencies [[`42247b2`](https://github.com/qlan-ro/mainframe/commit/42247b286a41e12d8c0cbc988d0ed19e48fe1c0c), [`ca40380`](https://github.com/qlan-ro/mainframe/commit/ca40380a1ce06958d2ded441c0a6c3ece16b42e7), [`3b3f733`](https://github.com/qlan-ro/mainframe/commit/3b3f733836c9092148a7b095041c97d5d1839be4), [`e81b98b`](https://github.com/qlan-ro/mainframe/commit/e81b98be207c5b713d1d0b7e7ee9e7b14852100f), [`e81b98b`](https://github.com/qlan-ro/mainframe/commit/e81b98be207c5b713d1d0b7e7ee9e7b14852100f)]:
  - @qlan-ro/mainframe-ui@2.5.0

## 2.1.0

### Minor Changes

- [#718](https://github.com/qlan-ro/mainframe/pull/718) [`43f6d74`](https://github.com/qlan-ro/mainframe/commit/43f6d740d68927362728b8054fa5802e60f37dc5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Chats can now be created without a project (a hidden scratch project owns their per-chat scratch cwd under the data dir) or marked temporary at creation (excluded from default listings, refuses pin/tag/archive/unarchive, and removed only by an explicit discard or by removing its project). `Chat` gains `temporary`, `noProject` and `contextLostAt`; `POST /api/chats` accepts `noProject` and `temporary`, and a new `POST /api/chats/{id}/discard` removes a temporary chat and its scratch directory. Forking a temporary or no-project chat is refused (409), and the Fork action is disabled for them with the reason shown.

### Patch Changes

- Updated dependencies [[`30f931e`](https://github.com/qlan-ro/mainframe/commit/30f931ecf0e0d2cfad03417c3bf79444448bfab6), [`af46807`](https://github.com/qlan-ro/mainframe/commit/af4680785904e846caf96340af0ab2c22d5d669b), [`d26d714`](https://github.com/qlan-ro/mainframe/commit/d26d71418066fbdec7e0bc68bdf9a5340036e1dd), [`21b5fd8`](https://github.com/qlan-ro/mainframe/commit/21b5fd88eac0ab541527d23dd8747d3c7d7e725e), [`962e505`](https://github.com/qlan-ro/mainframe/commit/962e505bcc7c23b922cc61fd0c5f0fa279d02614), [`d0e8fbd`](https://github.com/qlan-ro/mainframe/commit/d0e8fbd17fe6889782c9f11de89efbd58f826756), [`ac60006`](https://github.com/qlan-ro/mainframe/commit/ac6000670e3f797bb3aa27bfbdd91783d07a4640), [`fbae001`](https://github.com/qlan-ro/mainframe/commit/fbae0010f9747cc96eb215779117898e31afcd9d), [`43f6d74`](https://github.com/qlan-ro/mainframe/commit/43f6d740d68927362728b8054fa5802e60f37dc5), [`43f6d74`](https://github.com/qlan-ro/mainframe/commit/43f6d740d68927362728b8054fa5802e60f37dc5), [`e97842e`](https://github.com/qlan-ro/mainframe/commit/e97842e818cae36dbca0ccca79f622a8c67cf6d9)]:
  - @qlan-ro/mainframe-ui@2.4.0

## 2.0.6

### Patch Changes

- Updated dependencies [[`0b68c88`](https://github.com/qlan-ro/mainframe/commit/0b68c889995bdda629e76cab1f96940d5707248e), [`d5f0ec8`](https://github.com/qlan-ro/mainframe/commit/d5f0ec8bf8bfaa90204f81d102ff3c26623e9ffa), [`f0bbf3c`](https://github.com/qlan-ro/mainframe/commit/f0bbf3c7b2beb6adc25f6243a9107c7f55b6494c), [`49dc81f`](https://github.com/qlan-ro/mainframe/commit/49dc81f45a1fd87b35462240c5271eeb45c84ebc), [`dc5f441`](https://github.com/qlan-ro/mainframe/commit/dc5f441fdc934942e7ce65255a2ba192163fad4e), [`dfad3c4`](https://github.com/qlan-ro/mainframe/commit/dfad3c43f2405067f2371406d5ad1dc5914b5614), [`e3c528d`](https://github.com/qlan-ro/mainframe/commit/e3c528d9c4ee24868b8de5e1aca2186f8c35044f), [`c3593e8`](https://github.com/qlan-ro/mainframe/commit/c3593e80ccff547b1ba4a8254193569cde08a2ea), [`0ba4b2f`](https://github.com/qlan-ro/mainframe/commit/0ba4b2f94f03e7ce39cc53711cdc520931aa965d), [`b3d6a2d`](https://github.com/qlan-ro/mainframe/commit/b3d6a2d95b394e604346167777ccf7cd835f9ba9)]:
  - @qlan-ro/mainframe-ui@2.3.2

## 2.0.5

### Patch Changes

- Updated dependencies [[`e1bb693`](https://github.com/qlan-ro/mainframe/commit/e1bb693cef9c180e802f2df107e11f81f6ddcd6f)]:
  - @qlan-ro/mainframe-ui@2.3.1

## 2.0.4

### Patch Changes

- Updated dependencies [[`8b54f69`](https://github.com/qlan-ro/mainframe/commit/8b54f69a3dacafdc05e29e517342918f9c589399), [`d702fa2`](https://github.com/qlan-ro/mainframe/commit/d702fa242d1484416e40e98ec74b3750e3bd32f6)]:
  - @qlan-ro/mainframe-ui@2.3.0

## 2.0.3

### Patch Changes

- Updated dependencies [[`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97), [`7a888f5`](https://github.com/qlan-ro/mainframe/commit/7a888f5b9aa40dfb403a8734466f55b6eb557af9), [`23e3669`](https://github.com/qlan-ro/mainframe/commit/23e3669f5b2e0c11ac24d2ca7d51283519446e97), [`8b36033`](https://github.com/qlan-ro/mainframe/commit/8b3603326612e354422ed51b1dd0c68a351a302f)]:
  - @qlan-ro/mainframe-ui@2.2.0

## 2.0.2

### Patch Changes

- Updated dependencies [[`7bc0ef3`](https://github.com/qlan-ro/mainframe/commit/7bc0ef3a1db69ee19d26e4abf0b128492832e98e)]:
  - @qlan-ro/mainframe-ui@2.1.1

## 2.0.1

### Patch Changes

- Updated dependencies [[`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`e5011d6`](https://github.com/qlan-ro/mainframe/commit/e5011d666816ce4f72ed9a9fbcc389e28964f91b), [`91c18fe`](https://github.com/qlan-ro/mainframe/commit/91c18fe23da189f5d76cd76acdcb1a469cb10d1f), [`ae77a83`](https://github.com/qlan-ro/mainframe/commit/ae77a839f28b4a9c18f830bc3ca9be72c370b10d)]:
  - @qlan-ro/mainframe-ui@2.1.0
