# Todo #415: local image paths in assistant Markdown (plan, short form)

## Goal

A Markdown image whose source is an absolute filesystem path or a `file://` URL loads its bytes from the daemon (`GET /api/files/external?encoding=base64`) and renders through `ZoomableImage`. While loading, it shows a 256x160 skeleton. On any failure it shows the alt text (or the file's base name when there is no alt) as a `FileRefLink` followed by a muted "(image unavailable)". The webview's broken-image box never appears. http(s) and `data:` images are unchanged. Relative and `~/` sources are unchanged too (out of scope), and so are link hrefs.

## Files

- `packages/ui/src/lib/files/local-image.ts` (new, pure plus a small cache).
  - `localImagePath(src)` returns the absolute host path for a local image source, otherwise `null`. It runs `parseFileHref` first. A `file://` target is decoded with `fileUriToPath`. Any other target is accepted only if it is absolute: POSIX `/…`, Windows `C:\…`/`C:/…`, or UNC. Relative and `~/` targets return `null`.
  - `imageMimeForPath(path)` covers png/jpg/jpeg/gif/webp, the same set as `viewer-router`'s `IMAGE_EXTS` and `imageDataUrl`, and returns `null` for anything else.
  - `loadLocalImage(path)` returns a `Promise<string>` that resolves to a data URI. Results are cached by `apiBase() + path` in a module-level Map holding the in-flight or settled promise. Rejections are cached too, so a missing file is not refetched on every streaming re-render. The Map is bounded (for example, 32 entries, evicting the oldest) because entries can be data URIs of up to 10 MB. Export a test-only cache reset.
- `packages/ui/src/features/chat/parts/markdown-url-transform.ts`. In `urlTransform`, `key === 'src' && localImagePath(url) !== null` returns `url` unchanged. The `href` branch stays as it is. Update the header comment, which currently marks live file images as out of scope.
- `packages/ui/src/features/chat/parts/MarkdownImage.tsx` (new). This is the `img` override. A non-local `src` renders a plain `<img {...props}>`, exactly as react-markdown does today. A local `src` renders `LocalMarkdownImage`, which has three states:
  - **Loading:** `<span>` (not `Skeleton`, which is a `div` and invalid inside `<p>`) with `inline-block h-40 w-64 animate-pulse rounded-md bg-muted ring-1 ring-border`.
  - **Loaded:** `ZoomableImage` with the tool-result thumbnail classes from `VerboseParts` (`max-h-80 max-w-full rounded-md border border-border object-contain`).
  - **Error:** `FileRefLink` (with `href` = original src and `fileTarget` = `parseFileHref(src)`), then `<span className="text-muted-foreground"> (image unavailable)</span>`.

  A non-image extension goes straight to the error state without fetching. A decode failure of the data URI (`<img onError>`) also switches to the error state.
- `packages/ui/src/features/chat/parts/ZoomableImage.tsx`. Add an optional `onError` prop, forwarded to the thumbnail `<img>` only.
- `packages/ui/src/features/chat/parts/markdown-text.tsx`. Add `img: MarkdownImage` to `markdownComponents`. Surfaces that share this map (user message, plan bubble, plan gate, review card) get the feature for free, which the brief allows. `MarkdownPreview` keeps its own map and is untouched.
- Tests:
  - `parts/__tests__/markdown-url-transform.test.ts`: flip the "still strips a file:// value on … img src" case. `src` now keeps `file:///…`, `/abs/x.png` and `C:/x.png`. A relative or `~/` src is unchanged from today. `javascript:` and other unsafe schemes on `src` are still stripped.
  - New `parts/__tests__/markdown-image.test.tsx`, with `getExternalFile` mocked:
    - Loading shows the skeleton.
    - Loaded shows the zoom trigger, and clicking it opens the lightbox.
    - A rejected fetch renders the alt link plus the suffix, and no `<img>`.
    - Empty alt falls back to the base name.
    - A non-image extension makes no fetch.
    - `https:` and `data:` sources render a plain `<img>` and make no fetch.
    - Re-rendering, or mounting a second instance of the same path, calls the fetch once.
  - New `lib/files/__tests__/local-image.test.ts` for `localImagePath` and `imageMimeForPath`.
- `.changeset/<name>.md`: patch bump for the UI package.

## Risks

- **Cache memory:** data URIs can be up to 10 MB each. The bounded Map keeps memory finite. Re-fetching after eviction is acceptable.
- **Cross-daemon staleness:** the cache key includes `apiBase()`, so switching the active daemon does not serve another host's bytes.
- **Invalid DOM nesting:** every element of the override must be phrasing content (`span`, `button`, `img`, `a`), because react-markdown places images inside `<p>`.
- **Provider safety:** the override must not call `useDaemonPort()`, which throws outside its provider. `apiBase()` ignores the port argument, so pass any number, for example `0`. `FileRefLink` is already provider-safe.
- **Layout shift:** a small shift when the skeleton is replaced by the image is accepted by the design.

## Established facts

- react-markdown's `defaultUrlTransform` keeps a protocol-less value such as `/tmp/a.png` unchanged and turns `file:` or `C:` (an unsafe "protocol") into `''`. Receipt: `react-markdown@10.1.0/lib/index.js` `defaultUrlTransform`.
- `apiBase(_port?)` ignores the port and returns `getActiveDaemon().baseUrl`, and `request` carries remote auth. Receipt: `packages/ui/src/lib/api/http.ts` `apiBase`, `authHeaders`.
- `getExternalFile(port, path, 'base64')` returns raw base64 with no mime type. Receipt: `packages/ui/src/lib/api/files.ts` `getExternalFile`.
- The daemon's external endpoint returns 404 when canonicalize fails (missing file, no `~` expansion), 403 for blocklisted paths, and errors above 10 MB for base64. That 10 MB is the image size cap the brief asks us to reuse. Receipt: `packages/core-rs/crates/mainframe-server/src/routes/files.rs` `external_file_content`, `routes/files/external.rs` `validate_external_file` (`max_mb`).
- `parseFileHref` accepts relative paths and `~/` too, and does not decode `file://` paths. Receipt: `packages/ui/src/lib/files/file-href.ts` `parseFileHref`. `fileUriToPath` decodes them: `packages/ui/src/lib/files/file-uri.ts`.
- `useDaemonPort` throws outside `DaemonPortProvider`, and `markdownComponents` renders on surfaces without that provider. Receipt: `packages/ui/src/features/sessions/runtime/daemon-port-context.tsx`, and the doc comment on `features/chat/smart-actions/SmartLink.tsx`.
- `FileRefLink` uses only provider-less hooks and renders its children after a `FileCode2` glyph. Receipt: `packages/ui/src/features/chat/parts/FileRefLink.tsx` `FileRefLink`.
- `Skeleton` renders a `div` with `animate-pulse rounded-md bg-muted`. Receipt: `packages/ui/src/components/ui/skeleton.tsx`.

## Exit gates (single implementation group, TDD inline)

1. Write the transform and `local-image` unit tests first and confirm they fail. Then implement them and get them passing.
2. Write the `markdown-image` component tests and confirm they fail. Then implement `MarkdownImage`, the `ZoomableImage` `onError` prop and the `markdownComponents` wiring.
3. The existing ZoomableImage, markdown-text and file-ref-link tests still pass. UI typecheck and lint are clean.
4. In the running app, in light and dark themes:
   - An assistant message with `![x](/abs/existing.png)` and one with `file:///abs/existing.jpg` render inline and open the lightbox.
   - A missing path shows the link plus "(image unavailable)" and no broken box.
   - An https image is unchanged.
   - Capture screenshots as evidence.
5. A changeset is present.
