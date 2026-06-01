---
"@qlan-ro/mainframe-core": patch
---

refactor(core): consolidate git layer - shared parsers, single base-branch detection, async worktree exec (WS5)

The git route layer duplicated parsing and base-branch logic, and the worktree
helper talked to git three different ways including blocking sync I/O on the
daemon event loop.

- Extract byte-identical `isNotGitRepo`, `parseDiffNameStatus`, `parseStatusLines`
  and the porcelain bucket parser (typo `parsePortcelainStatus` fixed to
  `parseStatusBuckets`) into one shared `git/git-parse.ts`, with direct unit tests.
- Replace the three copies of the `['main','master']` merge-base loop with a single
  `GitService.detectBaseBranch()`; routes consume it. Response shapes unchanged.
- Migrate `workspace/worktree.ts` off `execFileSync`/`mkdirSync` and its private
  `promisify(execFile)` onto the canonical async `execGit` + `fs/promises`;
  `createWorktree` and `getWorktrees` no longer block the event loop. Callers in
  `config-manager.ts` await accordingly.
- Remove the dead, unexported `isGitRepo` helper (zero callers).

Pure refactor; behavior preserved. Full build green, core tests 1611 pass.
