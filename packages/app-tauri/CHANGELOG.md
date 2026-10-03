# @qlan-ro/mainframe-app-tauri

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
