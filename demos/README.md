# Demos

Recorded product demos, driven by the `feature-recorder` skill
(`~/.agents/skills/feature-recorder/SKILL.md` — read it first; this file only
covers what is specific to this repo).

`github/` is the shipped tour: four segments concatenated into
`github/mainframe-demo.mp4` (1920×1080, ~1:21), plus a matching Recordly project
for editing.

## Prerequisites

```bash
npm install -g @playwright/cli@latest    # need ≥ 0.1.18 for page.screencast
which ffmpeg                             # concat + H.264
```

Never record through `packages/e2e`'s Playwright: `page.screencast` only exists
in the 1.63-alpha the CLI bundles, and the suite pins 1.61.

## The segments

| Script | Recording key | Beats |
|---|---|---|
| `github/a-sessions.demo.js` | `tool-group` | projects and sessions, a prompt, grouped tool cards |
| `github/b-gate.demo.js` | `ask-question` | the inline question gate, answered without leaving |
| `github/d-threads.demo.js` | `workflow` | quote from the transcript, session rail, a **live workflow run**, quick task |
| `github/c-surfaces.demo.js` | any | worktree, board, automations, remote pairing, review + inline comment |
| `github/e-tabs-split.demo.js` | `tool-group` | tabs and split chat — **not in the cut**, `session-tab-ctx-open-split` is disabled unless two *committed* sessions exist |

## Recording a take

**One recording per boot.** The mock adapter's replay index is global: the first
send of a daemon boot consumes `<key>.0.ndjson`, and a second send looks for
`.1` and hangs forever. So every take — including every retake — needs a fresh
`.agents/demo-env.sh up`.

```bash
take() {                       # take <recording-key> <script> <session> <out-name>
  local key=$1 script=$2 sess=$3 out=$4
  for attempt in 1 2 3 4 5; do
    MF_DEMO_RECORDING_KEY=$key bash .agents/demo-env.sh up >/dev/null 2>&1
    playwright-cli close-all >/dev/null 2>&1
    playwright-cli -s=$sess open >/dev/null 2>&1
    playwright-cli -s=$sess --raw run-code --filename=$script > /tmp/raw.$out 2>&1
    if python3 -c "
import json,sys
txt=open('/tmp/raw.$out').read().strip(); raw=txt.splitlines()[-1] if txt else ''
try:
    d=json.loads(json.loads(raw)) if raw.startswith('\"') else json.loads(raw); assert d.get('marks')
except Exception: sys.exit(1)
json.dump(d, open('/tmp/mainframe-demo/out/$out.timeline.json','w'), indent=2)
print('$out: marks=%d' % len(d['marks']))
"; then return 0; fi
    echo "$out attempt $attempt: retake"
  done
  echo "$out FAILED"; return 1
}

take tool-group   demos/github/a-sessions.demo.js s1 tour-a
take ask-question demos/github/b-gate.demo.js     s2 tour-b
take workflow     demos/github/d-threads.demo.js  s3 tour-d
take tool-group   demos/github/c-surfaces.demo.js s4 tour-c
```

Each script returns its timeline as JSON on stdout — normalized position and
millisecond of every action — which the Recordly export turns into a cursor
track and zoom regions. `--raw` is what makes that the only thing printed.

## Rebuilding the cut

```bash
cd /tmp/mainframe-demo/out
node ~/.agents/skills/feature-recorder/scripts/to-recordly.mjs mainframe-demo \
  tour-a.webm tour-a.timeline.json  tour-b.webm tour-b.timeline.json \
  tour-d.webm tour-d.timeline.json  tour-c.webm tour-c.timeline.json
cp ~/Library/Application\ Support/Recordly/recordings/mainframe-demo.mp4 \
   <repo>/demos/github/mainframe-demo.mp4
```

That writes the H.264 concat, the cursor sidecar and the `.recordly` project, and
registers it. Open it from **Recordly → Open Projects** — `open -a Recordly <file>`
does not route the file, the app declares no document types.

## Known flakiness

- **The dropped-send race.** Roughly half of first sends into a fresh draft are
  dropped client-side: the console logs `new-thread-coordinator: workflow
  abandoned for __LOCALID_…`, the daemon creates then archives the chat, and no
  `user message sent` appears. The scripts `throw 'dropped send — retake'` rather
  than retype on camera. **Retrying inside one page session makes it worse** —
  opening another draft abandons the in-flight create — so recovery is a fresh
  take, or at minimum a full page reload.
- **`Screencast is already started`.** A take that throws leaves it running and
  masks the real error on every later run; each script calls
  `page.screencast.stop().catch(() => {})` before starting.
- **Forced clicks.** The sidebar rail never satisfies Playwright's stability
  check while the Kanban/Automations surfaces mount — those two use
  `click({ force: true })`, deliberately.
- **The session list can read "No sessions match these filters"** even with live
  sessions; the tab strip is the reliable surface.

## Out of scope for this rig

The terminal and the sandbox preview cannot be filmed: `lib/host/fake-adapter.ts`
rejects `terminal.create` and `preview.capture` whenever `__TAURI_INTERNALS__` is
absent, which is every browser. Tauri's WKWebView has no CDP for Playwright, and
the tauri-mcp bridge cannot record video.
