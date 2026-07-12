# Rust port — wire-contract freeze

This directory holds the machine-readable freeze of the Node daemon's wire
contract (`@qlan-ro/mainframe-core`). The Rust port must serialize
byte-compatibly with it. Treat `CONTRACT/*.json` as generated artifacts, not
hand-edited files.

## Artifacts

- `CONTRACT/routes.json` — every HTTP route: method, path, auth requirement,
  request schema, response envelope, and observed status codes.
- `CONTRACT/ws-events.json` — every WebSocket message type: client→server
  (with runtime Zod validation schema) and server→client `DaemonEvent`, plus
  connection/subscription/broadcast semantics.

## How it's generated

The generator lives at `packages/core/scripts/extract-contract.mjs` (helpers in
`packages/core/scripts/lib/`). It combines two deterministic passes:

1. **Router walk.** Every route factory is imported and mounted the way
   `src/server/http.ts` does, with a `Proxy` standing in for all runtime
   dependencies, and the live Express router stack is walked. This is the
   authoritative method+path list — nothing is hand-listed.
2. **Static AST analysis.** `src/server/routes/*.ts` and
   `packages/types/src/events.ts` are parsed with the TypeScript compiler API to
   recover per-endpoint request schemas, response shapes, status codes, and the
   `DaemonEvent` / `ClientEvent` unions. Exported Zod schemas are converted to
   JSON Schema via zod v4's native `z.toJSONSchema`; inline module-local schemas
   are captured as their Zod source text.

Each route carries a `confidence` (`high` / `medium` / `low`). `medium` means the
request body is an inline Zod schema captured as source rather than resolved
JSON Schema; nothing is omitted.

## Regenerate

```sh
pnpm --filter @qlan-ro/mainframe-core exec tsx scripts/extract-contract.mjs
```

Output is sorted and timestamp-free, so regeneration is byte-stable.

## Diff / freeze check (CI)

The contract is frozen: any change to routes, schemas, or events must be an
intentional, reviewed diff. Regenerate and fail if the working tree changed:

```sh
pnpm --filter @qlan-ro/mainframe-core exec tsx scripts/extract-contract.mjs
git diff --exit-code docs/rust-port/CONTRACT
```

A non-zero exit means the daemon's wire surface drifted without the frozen
contract being updated in the same change. Wire it as a CI job on every PR that
touches `packages/core/src/server/**`, `packages/core/src/server/ws-schemas.ts`,
or `packages/types/src/events.ts`. Suggested npm script (add to
`packages/core/package.json`, not done here to stay within task ownership):

```json
"contract:extract": "tsx scripts/extract-contract.mjs",
"contract:check": "tsx scripts/extract-contract.mjs && git diff --exit-code ../../docs/rust-port/CONTRACT"
```

## Known deviations from the canonical envelope

These are intentional and reproduced in `routes.json` (`knownDeviations`); a port
must preserve them exactly rather than "fixing" them:

- `DELETE /api/tags/:name` → bare `204`, no envelope.
- `GET /health` → bare status object, not `{success,data}`.
- `POST /api/projects` → `409` carries a `data` payload alongside `success:false`.
