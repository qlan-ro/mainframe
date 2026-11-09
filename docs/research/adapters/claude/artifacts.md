# Claude artifacts

How Mainframe shows claude.ai artifacts, and what it depends on. Verified on CLI 2.1.318. Everything here is undocumented CLI behavior, so check it first if previews break after a CLI update.

## Why a local download

- claude.ai sends `frame-ancestors 'self'`, so it can't be framed. A native webview can load it, but it needs its own sign-in, and Google sign-in fails there.
- Artifacts are off for SDK entrypoints (`sdk_default_off`) unless `CLAUDE_CODE_ARTIFACT=1` is set; `/design` then falls back to managing agent access only. Mainframe sets the flag on chat sessions.

## The download path

The daemon runs `claude mcp serve` with the same flag. It needs no model, spends no tokens, and uses the CLI's own login. `mainframe-adapter-claude/src/artifact_client.rs` exposes only these two read-only calls, because tool calls made this way have no permission prompt:

| Call | Result |
| --- | --- |
| `Artifact { action: "list", url, scope: "files" }` | `file_list`: `ver`, `from_type`, and `files` with `path`, `size_bytes`, `sha256` |
| `Artifact { action: "read", url, paths }` | `files_read`: `title`, `saved_dir`, and `files` with `path`, `saved_to` |

An artifact's version never changes once published, so the cache is keyed by slug and version.

Cached artifacts are plain private files, so `retention.rs` limits them: a new version replaces the old one, anything not opened for 30 days goes, and the oldest go first past 500 MB. Each helper run also leaves a session folder in the CLI's spool, keyed by the helper's working directory, which the same pass removes after an hour. Chat scratchpads belong to the CLI and are never touched.

## What each artifact looks like

| Kind | Files | Preview |
| --- | --- | --- |
| Design | `project/canvas.json`, `project/*.dc.html` | One frame per board |
| Slides | `project/deck.json`, `project/slides/<id>.html` | One frame per slide, 1920×1080 |
| Untyped page | `list` returns no files; `read` with `paths: ["index.html"]` returns the page | The page |
| Migrated design (from standalone Claude Design) | Whole pages in `project/*.html`, each loading React and Babel from unpkg and its own `.jsx` files, plus `project/.design-canvas.state.json` | A page picker, one page at a time; each page draws its own canvas |
| Docs, Dashboard | Only the type's viewer; content is in claude.ai's database | claude.ai |
| Design System | `preview.html` fragments that claude.ai's page completes with React and the bundle | claude.ai |

`read` without `paths` returns text for the model, capped at 50,000 characters, so it can't stand in for a download.

`.dc.html` files load `./support.js`. The route answers that with the artifact's own `artifact-type/dc-runtime.js`, which boots itself.

## Inspect and live updates

The route adds `picker.js` to every page it serves. Inspect's own picker runs only in the top document, so `picker.js` takes over its install hooks there, picks inside the board frames, and reports through the usual `inspect_result` command. The selector names the artifact, board, element path and text, so an agent can find the source: `artifact <url> | board <page> | <path> | text "<text>"`.

Every successful publish, from any chat or subagent, makes the daemon emit a global `artifact.published` event, read from the result's first line. The UI then moves open tabs to the newest version. A tab the UI can't reach then, such as one in another chat's workspace, recovers when it next loads: a request for a version that is gone redirects to the newest cached one, or downloads it.

## Canvas

A design opens as a canvas (`mf-canvas.js`): boards at their `canvas.json` frames in `order`, `title1` and sticky notes, a page picker when there are pages, and the `launch` view. Scroll or drag pans and pinch or Cmd/Ctrl+scroll zooms. Boards sit under shields so gestures over them move the canvas; double-click one to use it, and Escape returns. Drawn shapes (`rect`, `oval`, `pen` and the like) aren't shown.

## Limits

- The CLI refuses a public artifact from outside the user's organization until a person agrees, so `list` fails and the UI falls back to the browser.
- Designs may reference `/_blob/<id>` uploads, which aren't downloaded. None of the artifacts surveyed used them.
- Design content is untrusted. The route's CSP `sandbox` gives it an opaque origin and limits it to its own version's files, Google Fonts, and scripts from the CDNs claude.ai allows artifacts (cdnjs, jsDelivr, unpkg, Tailwind, jQuery).
- Mainframe can't show Docs, Dashboards, Design Systems, or an artifact it fails to download; Open then goes to claude.ai and says why.
