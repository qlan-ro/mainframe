# @qlan-ro/mainframe-app-tauri

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
