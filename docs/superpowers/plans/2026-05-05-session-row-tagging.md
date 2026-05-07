# Session Row Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-defined tags on session rows plus synthetic `has-pr` / `has-worktree` filter chips, while moving worktree pill and PR badge into the title row.

**Architecture:** New `tags` (registry) and `chat_tags` (associations) SQLite tables in core. Synthetic chips are computed at query time from existing `chats.worktree_path` / PR fields, not stored. HTTP API only — no WS events. Frontend gets a Zustand `tags` store, `FilterBar` above the chats list, `TagPopover` triggered by right-click and tag-row click, and a refactored `FlatSessionRow`.

**Tech Stack:** TypeScript (NodeNext), better-sqlite3, Express + Zod, React + Zustand, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-05-session-row-tagging-design.md`

---

## File Map

**New:**
- `packages/types/src/tags.ts` — `Tag`, `TagColor`, `TAG_PALETTE`, `RESERVED_TAG_PREFIX`, `Synthetic` constants
- `packages/core/src/lib/validate-tag-name.ts` + test — name validation single source of truth
- `packages/core/src/lib/tag-color.ts` + test — stable hash → palette index
- `packages/core/src/db/tags.ts` + test — `TagsRepository` (registry CRUD)
- `packages/core/src/db/chat-tags.ts` + test — `ChatTagsRepository` (associations + filter queries)
- `packages/core/src/server/routes/tags.ts` + test — tag registry + chat-tags HTTP routes
- `packages/desktop/src/renderer/lib/api/tags-api.ts` — client for tag endpoints
- `packages/desktop/src/renderer/store/tags.ts` + test — Zustand store
- `packages/desktop/src/renderer/components/tags/TagPill.tsx`
- `packages/desktop/src/renderer/components/tags/TagPopover.tsx`
- `packages/desktop/src/renderer/components/panels/SessionFilterBar.tsx`

**Modified:**
- `packages/types/src/chat.ts` — add `tags?: string[]`
- `packages/types/src/index.ts` — export `./tags.js`
- `packages/core/src/db/schema.ts` — add `tags` and `chat_tags` table DDL
- `packages/core/src/db/index.ts` — wire `TagsRepository` + `ChatTagsRepository`
- `packages/core/src/db/chats.ts` — populate `tags` on `list()` / `get()`, add filtered list
- `packages/core/src/server/routes/index.ts` — export `tagRoutes`
- `packages/core/src/server/index.ts` — mount `tagRoutes`
- `packages/desktop/src/renderer/lib/api/index.ts` — re-export tag api
- `packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx` — move worktree + PR to title row, add tag row
- `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx` — mount `SessionFilterBar`, use filter state

---

## Task 1: Shared types

**Files:**
- Create: `packages/types/src/tags.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/chat.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/types/src/__tests__/tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TAG_PALETTE, RESERVED_TAG_PREFIX, SYNTHETIC_TAGS } from '../tags.js';

describe('tag constants', () => {
  it('TAG_PALETTE is non-empty and immutable', () => {
    expect(TAG_PALETTE.length).toBeGreaterThan(0);
    expect(Object.isFrozen(TAG_PALETTE)).toBe(true);
  });
  it('RESERVED_TAG_PREFIX is "has-"', () => {
    expect(RESERVED_TAG_PREFIX).toBe('has-');
  });
  it('SYNTHETIC_TAGS contains has-pr and has-worktree only', () => {
    expect([...SYNTHETIC_TAGS].sort()).toEqual(['has-pr', 'has-worktree']);
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- tags.test.ts`
Expected: FAIL — Cannot find module `../tags.js`.

- [ ] **Step 3: Create `packages/types/src/tags.ts`**

```ts
export const TAG_PALETTE = Object.freeze([
  'blue', 'red', 'purple', 'violet', 'amber',
  'teal', 'cyan', 'green', 'pink', 'orange',
] as const);
export type TagColor = (typeof TAG_PALETTE)[number];

export const SYNTHETIC_TAG_COLOR: TagColor | 'gray' = 'gray';
export const RESERVED_TAG_PREFIX = 'has-';

export const SYNTHETIC_TAGS = Object.freeze(['has-pr', 'has-worktree'] as const);
export type SyntheticTag = (typeof SYNTHETIC_TAGS)[number];

export interface Tag {
  name: string;
  color: TagColor;
  createdAt: string;
}
```

Note: `SYNTHETIC_TAG_COLOR` is typed wider than `TagColor` because `'gray'` is intentionally outside the user palette — it signals "system chip" in the filter bar.

- [ ] **Step 4: Add `tags?: string[]` to `Chat` interface**

In `packages/types/src/chat.ts` after line 39 (`effort?: ChatEffort;`), add:

```ts
  /** User-source tags applied to this chat. Synthetic chips (has-pr, has-worktree) are NOT included. */
  tags?: string[];
```

- [ ] **Step 5: Re-export from index**

In `packages/types/src/index.ts`, add the line:

```ts
export * from './tags.js';
```

- [ ] **Step 6: Re-run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- tags.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/tags.ts packages/types/src/__tests__/tags.test.ts packages/types/src/index.ts packages/types/src/chat.ts
git commit -m "feat(types): tag palette, reserved prefix, synthetic tag constants"
```

---

## Task 2: Validation helper

**Files:**
- Create: `packages/core/src/lib/validate-tag-name.ts`
- Test: `packages/core/src/lib/__tests__/validate-tag-name.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateTagName } from '../validate-tag-name.js';

describe('validateTagName', () => {
  it.each([
    ['feature', { ok: true, normalized: 'feature' }],
    ['  Feature  ', { ok: true, normalized: 'feature' }],
    ['ui-bug', { ok: true, normalized: 'ui-bug' }],
    ['perf-2', { ok: true, normalized: 'perf-2' }],
  ])('accepts %s', (input, expected) => {
    expect(validateTagName(input)).toEqual(expected);
  });

  it.each([
    ['', 'empty'],
    ['a', 'too short'],
    ['a'.repeat(25), 'too long'],
    ['has-pr', 'reserved prefix'],
    ['has-anything', 'reserved prefix'],
    ['feature!', 'invalid characters'],
    ['white space', 'invalid characters'],
  ])('rejects %s', (input, _label) => {
    const result = validateTagName(input);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- validate-tag-name.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement validator**

Create `packages/core/src/lib/validate-tag-name.ts`:

```ts
import { RESERVED_TAG_PREFIX } from '@qlan-ro/mainframe-types';

const PATTERN = /^[a-z0-9-]+$/;
const MIN_LEN = 2;
const MAX_LEN = 24;

export type ValidateResult =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

export function validateTagName(input: string): ValidateResult {
  const normalized = input.trim().toLowerCase();
  if (normalized.length < MIN_LEN) return { ok: false, error: 'Tag name too short (min 2 chars).' };
  if (normalized.length > MAX_LEN) return { ok: false, error: 'Tag name too long (max 24 chars).' };
  if (normalized.startsWith(RESERVED_TAG_PREFIX)) {
    return { ok: false, error: `Names starting with "${RESERVED_TAG_PREFIX}" are reserved.` };
  }
  if (!PATTERN.test(normalized)) {
    return { ok: false, error: 'Tag name must use lowercase letters, numbers, or hyphens only.' };
  }
  return { ok: true, normalized };
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- validate-tag-name.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/validate-tag-name.ts packages/core/src/lib/__tests__/validate-tag-name.test.ts
git commit -m "feat(core): tag name validation helper"
```

---

## Task 3: Color hashing helper

**Files:**
- Create: `packages/core/src/lib/tag-color.ts`
- Test: `packages/core/src/lib/__tests__/tag-color.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { hashTagColor } from '../tag-color.js';

describe('hashTagColor', () => {
  it('returns a palette color', () => {
    const c = hashTagColor('feature');
    expect(TAG_PALETTE).toContain(c);
  });
  it('is deterministic for the same name', () => {
    expect(hashTagColor('bug')).toBe(hashTagColor('bug'));
  });
  it('distributes across different names', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(hashTagColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- tag-color.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement hash**

Create `packages/core/src/lib/tag-color.ts`:

```ts
import { TAG_PALETTE, type TagColor } from '@qlan-ro/mainframe-types';

/** Stable djb2 hash → palette index. Same name always maps to same color. */
export function hashTagColor(name: string): TagColor {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % TAG_PALETTE.length;
  return TAG_PALETTE[idx]!;
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- tag-color.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lib/tag-color.ts packages/core/src/lib/__tests__/tag-color.test.ts
git commit -m "feat(core): stable tag color hash"
```

---

## Task 4: DB schema migration

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Test: `packages/core/src/db/__tests__/schema.test.ts` (extend or create)

- [ ] **Step 1: Write the failing test**

Append to (or create) `packages/core/src/db/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';

describe('schema — tags', () => {
  it('creates tags and chat_tags tables', () => {
    const db = new Database(':memory:');
    initializeSchema(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('tags');
    expect(names).toContain('chat_tags');
  });
  it('chat_tags cascades on chat deletion', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)',
    ).run('p1', 'p', '/tmp/p', now, now);
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c1', 'claude', 'p1', 'active', now, now);
    db.prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)').run('feature', 'blue', now);
    db.prepare(
      "INSERT INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
    ).run('c1', 'feature', now);
    db.prepare('DELETE FROM chats WHERE id = ?').run('c1');
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM chat_tags').get() as { n: number };
    expect(remaining.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test (should fail — tables not created)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add DDL to `packages/core/src/db/schema.ts`**

Inside the existing `db.exec(\`...\`)` block in `initializeSchema`, append before the closing backtick:

```sql
    CREATE TABLE IF NOT EXISTS tags (
      name       TEXT PRIMARY KEY,
      color      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_tags (
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      tag        TEXT NOT NULL REFERENCES tags(name) ON UPDATE CASCADE,
      source     TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, tag, source)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_tags_chat ON chat_tags(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chat_tags_tag  ON chat_tags(tag);
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/__tests__/schema.test.ts
git commit -m "feat(core): tags + chat_tags schema with cascade"
```

---

## Task 5: TagsRepository

**Files:**
- Create: `packages/core/src/db/tags.ts`
- Test: `packages/core/src/db/__tests__/tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';
import { TagsRepository } from '../tags.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return new TagsRepository(db);
}

describe('TagsRepository', () => {
  it('list returns empty initially', () => {
    expect(setup().list()).toEqual([]);
  });

  it('upsert creates a tag with auto-color when missing', () => {
    const repo = setup();
    const tag = repo.upsert('feature');
    expect(tag.name).toBe('feature');
    expect(tag.color).toBeTruthy();
    expect(repo.list()).toHaveLength(1);
  });

  it('upsert is idempotent', () => {
    const repo = setup();
    const a = repo.upsert('feature');
    const b = repo.upsert('feature');
    expect(b.color).toBe(a.color);
    expect(repo.list()).toHaveLength(1);
  });

  it('rejects reserved prefix', () => {
    expect(() => setup().upsert('has-pr')).toThrow(/reserved/i);
  });

  it('rename moves the row and cascades chat_tags', () => {
    const repo = setup();
    repo.upsert('feat');
    repo.rename('feat', 'feature');
    const names = repo.list().map((t) => t.name);
    expect(names).toContain('feature');
    expect(names).not.toContain('feat');
  });

  it('rename to existing name merges (drops the source row)', () => {
    const repo = setup();
    repo.upsert('feat');
    repo.upsert('feature');
    repo.rename('feat', 'feature');
    expect(repo.list()).toHaveLength(1);
  });

  it('recolor updates color only', () => {
    const repo = setup();
    repo.upsert('feature');
    repo.setColor('feature', 'red');
    expect(repo.list()[0]!.color).toBe('red');
  });

  it('remove deletes the row', () => {
    const repo = setup();
    repo.upsert('feature');
    repo.remove('feature');
    expect(repo.list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- db/__tests__/tags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement repository**

Create `packages/core/src/db/tags.ts`:

```ts
import type Database from 'better-sqlite3';
import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { validateTagName } from '../lib/validate-tag-name.js';
import { hashTagColor } from '../lib/tag-color.js';

export class TagsRepository {
  constructor(private db: Database.Database) {}

  list(): Tag[] {
    const rows = this.db
      .prepare('SELECT name, color, created_at as createdAt FROM tags ORDER BY name')
      .all() as Tag[];
    return rows;
  }

  get(name: string): Tag | null {
    const row = this.db
      .prepare('SELECT name, color, created_at as createdAt FROM tags WHERE name = ?')
      .get(name) as Tag | undefined;
    return row ?? null;
  }

  /** Idempotent upsert. Returns the existing row if present, else creates with auto color. */
  upsert(rawName: string, color?: TagColor): Tag {
    const v = validateTagName(rawName);
    if (!v.ok) throw new Error(v.error);
    const existing = this.get(v.normalized);
    if (existing) return existing;
    const finalColor: TagColor = color ?? hashTagColor(v.normalized);
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)')
      .run(v.normalized, finalColor, now);
    return { name: v.normalized, color: finalColor, createdAt: now };
  }

  setColor(name: string, color: TagColor): void {
    this.db.prepare('UPDATE tags SET color = ? WHERE name = ?').run(color, name);
  }

  /** Atomic rename. If `to` already exists, merges associations and drops `from`. */
  rename(fromRaw: string, toRaw: string): void {
    const from = fromRaw.trim().toLowerCase();
    const v = validateTagName(toRaw);
    if (!v.ok) throw new Error(v.error);
    const to = v.normalized;
    if (from === to) return;
    const tx = this.db.transaction(() => {
      const target = this.get(to);
      if (target) {
        // Merge: redirect chat_tags then delete `from` registry row.
        this.db
          .prepare(
            "INSERT OR IGNORE INTO chat_tags (chat_id, tag, source, created_at) " +
              "SELECT chat_id, ?, source, created_at FROM chat_tags WHERE tag = ?",
          )
          .run(to, from);
        this.db.prepare('DELETE FROM chat_tags WHERE tag = ?').run(from);
        this.db.prepare('DELETE FROM tags WHERE name = ?').run(from);
      } else {
        // Plain rename — ON UPDATE CASCADE moves chat_tags rows.
        this.db.prepare('UPDATE tags SET name = ? WHERE name = ?').run(to, from);
      }
    });
    tx();
  }

  remove(name: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_tags WHERE tag = ?').run(name);
      this.db.prepare('DELETE FROM tags WHERE name = ?').run(name);
    });
    tx();
  }
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- db/__tests__/tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/tags.ts packages/core/src/db/__tests__/tags.test.ts
git commit -m "feat(core): TagsRepository with idempotent upsert + merge-on-rename"
```

---

## Task 6: ChatTagsRepository

**Files:**
- Create: `packages/core/src/db/chat-tags.ts`
- Test: `packages/core/src/db/__tests__/chat-tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';
import { TagsRepository } from '../tags.js';
import { ChatTagsRepository } from '../chat-tags.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)',
  ).run('p1', 'p', '/tmp/p', now, now);
  for (const id of ['c1', 'c2', 'c3']) {
    db.prepare(
      'INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 'claude', 'p1', 'active', now, now);
  }
  return { tags: new TagsRepository(db), chatTags: new ChatTagsRepository(db) };
}

describe('ChatTagsRepository', () => {
  it('listForChat returns empty initially', () => {
    expect(setup().chatTags.listForChat('c1')).toEqual([]);
  });

  it('setForChat replaces user tags atomically', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature', 'ui'], tags);
    expect(chatTags.listForChat('c1').sort()).toEqual(['feature', 'ui']);
    chatTags.setForChat('c1', ['bug'], tags);
    expect(chatTags.listForChat('c1')).toEqual(['bug']);
  });

  it('setForChat auto-creates missing tags', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['mobile'], tags);
    expect(tags.get('mobile')).not.toBeNull();
  });

  it('listInUse returns distinct tags currently associated', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature'], tags);
    chatTags.setForChat('c2', ['feature', 'bug'], tags);
    expect(chatTags.listInUse().sort()).toEqual(['bug', 'feature']);
  });

  it('listInUse with projectId filters', () => {
    const db = setup();
    db.chatTags.setForChat('c1', ['feature'], db.tags);
    expect(db.chatTags.listInUse('p1').sort()).toEqual(['feature']);
    expect(db.chatTags.listInUse('p-other')).toEqual([]);
  });

  it('filterChatIds AND-intersects user tags', () => {
    const { tags, chatTags } = setup();
    chatTags.setForChat('c1', ['feature', 'ui'], tags);
    chatTags.setForChat('c2', ['feature'], tags);
    chatTags.setForChat('c3', ['bug'], tags);
    expect(chatTags.filterChatIds(['feature', 'ui'])!.sort()).toEqual(['c1']);
    expect(chatTags.filterChatIds(['feature'])!.sort()).toEqual(['c1', 'c2']);
    expect(chatTags.filterChatIds([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- chat-tags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement repository**

Create `packages/core/src/db/chat-tags.ts`:

```ts
import type Database from 'better-sqlite3';
import type { TagsRepository } from './tags.js';

export class ChatTagsRepository {
  constructor(private db: Database.Database) {}

  listForChat(chatId: string): string[] {
    const rows = this.db
      .prepare("SELECT tag FROM chat_tags WHERE chat_id = ? AND source = 'user' ORDER BY tag")
      .all(chatId) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  /** Map of chatId -> user tags. Used to populate Chat.tags on list queries. */
  bulkForChats(chatIds: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (chatIds.length === 0) return out;
    const placeholders = chatIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT chat_id as chatId, tag FROM chat_tags
         WHERE source = 'user' AND chat_id IN (${placeholders})
         ORDER BY chat_id, tag`,
      )
      .all(...chatIds) as { chatId: string; tag: string }[];
    for (const r of rows) {
      const list = out.get(r.chatId);
      if (list) list.push(r.tag);
      else out.set(r.chatId, [r.tag]);
    }
    return out;
  }

  /** Replace the user tag set for a chat atomically. Auto-creates any missing tags. */
  setForChat(chatId: string, tags: string[], registry: TagsRepository): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_tags WHERE chat_id = ? AND source = 'user'").run(chatId);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO chat_tags (chat_id, tag, source, created_at) VALUES (?, ?, 'user', ?)",
      );
      const now = new Date().toISOString();
      for (const raw of tags) {
        const tag = registry.upsert(raw); // throws on invalid input
        insert.run(chatId, tag.name, now);
      }
    });
    tx();
  }

  /**
   * Distinct user tags currently in use, optionally restricted to a project.
   * Drives the filter bar's tag chip list.
   */
  listInUse(projectId?: string): string[] {
    if (projectId) {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT ct.tag FROM chat_tags ct
           JOIN chats c ON c.id = ct.chat_id
           WHERE ct.source = 'user' AND c.project_id = ? AND c.status != 'archived'
           ORDER BY ct.tag`,
        )
        .all(projectId) as { tag: string }[];
      return rows.map((r) => r.tag);
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT ct.tag FROM chat_tags ct
         JOIN chats c ON c.id = ct.chat_id
         WHERE ct.source = 'user' AND c.status != 'archived'
         ORDER BY ct.tag`,
      )
      .all() as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  /**
   * Returns chat ids that have ALL of the supplied tags.
   * Returns null when `tags` is empty (caller treats null as "no tag filter").
   */
  filterChatIds(tags: string[]): string[] | null {
    if (tags.length === 0) return null;
    const placeholders = tags.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT chat_id FROM chat_tags
         WHERE source = 'user' AND tag IN (${placeholders})
         GROUP BY chat_id
         HAVING COUNT(DISTINCT tag) = ?`,
      )
      .all(...tags, tags.length) as { chat_id: string }[];
    return rows.map((r) => r.chat_id);
  }
}
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- chat-tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/chat-tags.ts packages/core/src/db/__tests__/chat-tags.test.ts
git commit -m "feat(core): ChatTagsRepository with AND-intersect filter"
```

---

## Task 7: Wire repos into DatabaseManager + populate Chat.tags

**Files:**
- Modify: `packages/core/src/db/index.ts`
- Modify: `packages/core/src/db/chats.ts`
- Test: `packages/core/src/db/__tests__/chats.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/db/__tests__/chats.test.ts`:

```ts
describe('chats list — populates tags', () => {
  it('Chat.tags reflects user-source associations', () => {
    // Use the same helper the existing tests use; this is a sketch:
    const dbm = makeManager(); // existing helper or new() of DatabaseManager-like
    dbm.projects.create('/tmp/p');
    const project = dbm.projects.list()[0]!;
    const chat = dbm.chats.createChat({ adapterId: 'claude', projectId: project.id });
    dbm.chatTags.setForChat(chat.id, ['feature', 'ui'], dbm.tags);
    const fresh = dbm.chats.list(project.id)[0]!;
    expect(fresh.tags?.sort()).toEqual(['feature', 'ui']);
  });
});
```

(Use the actual test helper present in the file. If `makeManager` doesn't exist, use the same construction pattern the existing chats test uses.)

- [ ] **Step 2: Run test (should fail — `dbm.tags` / `dbm.chatTags` undefined)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- db/__tests__/chats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire repos in `packages/core/src/db/index.ts`**

```ts
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import { initializeSchema } from './schema.js';
import { ProjectsRepository } from './projects.js';
import { ChatsRepository } from './chats.js';
import { SettingsRepository } from './settings.js';
import { DevicesRepository } from './devices.js';
import { TagsRepository } from './tags.js';
import { ChatTagsRepository } from './chat-tags.js';

export class DatabaseManager {
  private db: Database.Database;
  public projects: ProjectsRepository;
  public chats: ChatsRepository;
  public settings: SettingsRepository;
  public devices: DevicesRepository;
  public tags: TagsRepository;
  public chatTags: ChatTagsRepository;

  constructor() {
    const dbPath = join(getDataDir(), 'mainframe.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    initializeSchema(this.db);

    this.projects = new ProjectsRepository(this.db);
    this.tags = new TagsRepository(this.db);
    this.chatTags = new ChatTagsRepository(this.db);
    this.chats = new ChatsRepository(this.db, this.chatTags);
    this.settings = new SettingsRepository(this.db);
    this.devices = new DevicesRepository(this.db);
  }

  close(): void {
    this.db.close();
  }
}

export { ProjectsRepository } from './projects.js';
export { ChatsRepository } from './chats.js';
export { SettingsRepository } from './settings.js';
export { DevicesRepository } from './devices.js';
export { TagsRepository } from './tags.js';
export { ChatTagsRepository } from './chat-tags.js';
```

- [ ] **Step 4: Update `ChatsRepository` constructor to accept `chatTags` and populate `tags`**

In `packages/core/src/db/chats.ts`:

```ts
export class ChatsRepository {
  constructor(
    private db: Database.Database,
    private chatTags?: ChatTagsRepository,
  ) {}
```

Add the import at the top:

```ts
import type { ChatTagsRepository } from './chat-tags.js';
```

In `list()` (and any sibling `listAll()`), after the existing `rows.map(...)` produces the Chat array, before returning, fold in tags:

```ts
const chats = rows.map((row) => ({ /* existing mapping */ }));
if (this.chatTags && chats.length > 0) {
  const tagsByChat = this.chatTags.bulkForChats(chats.map((c) => c.id));
  for (const c of chats) {
    c.tags = tagsByChat.get(c.id) ?? [];
  }
}
return chats;
```

Apply the same pattern to `getChat`:

```ts
const chat = /* existing single-row fetch */;
if (chat && this.chatTags) {
  chat.tags = this.chatTags.listForChat(chat.id);
}
return chat;
```

The `chatTags` is optional in the constructor so existing tests that construct `new ChatsRepository(db)` directly still work; production goes through `DatabaseManager` which always passes it.

- [ ] **Step 5: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- db/__tests__/chats.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/index.ts packages/core/src/db/chats.ts packages/core/src/db/__tests__/chats.test.ts
git commit -m "feat(core): wire tag repos into DatabaseManager + populate Chat.tags"
```

---

## Task 8: Tag HTTP routes

**Files:**
- Create: `packages/core/src/server/routes/tags.ts`
- Test: `packages/core/src/server/routes/__tests__/tags.test.ts`
- Modify: `packages/core/src/server/routes/index.ts`
- Modify: `packages/core/src/server/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../../db/schema.js';
import { TagsRepository } from '../../../db/tags.js';
import { ChatTagsRepository } from '../../../db/chat-tags.js';
import { tagRoutes } from '../tags.js';

function makeApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const tags = new TagsRepository(db);
  const chatTags = new ChatTagsRepository(db);
  const ctx = { db: { tags, chatTags } } as any;
  const app = express();
  app.use(express.json());
  app.use(tagRoutes(ctx));
  return { app, db, tags, chatTags };
}

describe('tag routes', () => {
  it('GET /api/tags returns []', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('POST /api/tags creates a tag', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/tags').send({ name: 'feature' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('feature');
  });

  it('POST /api/tags rejects has- prefix with 400', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/tags').send({ name: 'has-foo' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/tags/:name renames', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feat');
    const res = await request(app).patch('/api/tags/feat').send({ rename: 'feature' });
    expect(res.status).toBe(200);
    expect(tags.get('feature')).not.toBeNull();
    expect(tags.get('feat')).toBeNull();
  });

  it('DELETE /api/tags/:name removes', async () => {
    const { app, tags } = makeApp();
    tags.upsert('feature');
    const res = await request(app).delete('/api/tags/feature');
    expect(res.status).toBe(204);
    expect(tags.get('feature')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (should fail — module missing)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- routes/__tests__/tags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement routes**

Create `packages/core/src/server/routes/tags.ts`:

```ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../logger.js';

const logger = createChildLogger('routes:tags');

const ColorSchema = z.enum(TAG_PALETTE);
const CreateBody = z.object({ name: z.string(), color: ColorSchema.optional() });
const PatchBody = z.object({ rename: z.string().optional(), color: ColorSchema.optional() }).refine(
  (v) => v.rename !== undefined || v.color !== undefined,
  { message: 'rename or color required' },
);
const SetChatTagsBody = z.object({ tags: z.array(z.string()) });

export function tagRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/api/tags', (_req: Request, res: Response) => {
    res.json({ success: true, data: ctx.db.tags.list() });
  });

  router.post('/api/tags', (req: Request, res: Response) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    try {
      const tag = ctx.db.tags.upsert(parsed.data.name, parsed.data.color);
      res.status(201).json({ success: true, data: tag });
    } catch (err) {
      logger.warn({ err }, 'create tag failed');
      res.status(400).json({ success: false, error: String((err as Error).message) });
    }
  });

  router.patch('/api/tags/:name', (req: Request, res: Response) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    const name = param(req, 'name');
    if (!ctx.db.tags.get(name)) {
      res.status(404).json({ success: false, error: 'Tag not found' });
      return;
    }
    try {
      if (parsed.data.rename) ctx.db.tags.rename(name, parsed.data.rename);
      const final = parsed.data.rename ?? name;
      if (parsed.data.color) ctx.db.tags.setColor(final, parsed.data.color);
      const result = ctx.db.tags.get(final);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.warn({ err, name }, 'update tag failed');
      res.status(400).json({ success: false, error: String((err as Error).message) });
    }
  });

  router.delete('/api/tags/:name', (req: Request, res: Response) => {
    const name = param(req, 'name');
    if (!ctx.db.tags.get(name)) {
      res.status(404).json({ success: false, error: 'Tag not found' });
      return;
    }
    ctx.db.tags.remove(name);
    res.status(204).end();
  });

  router.get('/api/chats/:id/tags', (req: Request, res: Response) => {
    const tags = ctx.db.chatTags.listForChat(param(req, 'id'));
    res.json({ success: true, data: tags });
  });

  router.put('/api/chats/:id/tags', (req: Request, res: Response) => {
    const parsed = SetChatTagsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.message });
      return;
    }
    try {
      ctx.db.chatTags.setForChat(param(req, 'id'), parsed.data.tags, ctx.db.tags);
      res.json({ success: true, data: ctx.db.chatTags.listForChat(param(req, 'id')) });
    } catch (err) {
      logger.warn({ err }, 'set chat tags failed');
      res.status(400).json({ success: false, error: String((err as Error).message) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Export and mount**

In `packages/core/src/server/routes/index.ts`, add:

```ts
export { tagRoutes } from './tags.js';
```

In `packages/core/src/server/index.ts`, locate where the other route routers are mounted (search for `chatRoutes(ctx)` etc.) and add a sibling `app.use(tagRoutes(ctx));`. The exact insertion point follows the existing pattern in that file.

- [ ] **Step 5: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- routes/__tests__/tags.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/server/routes/tags.ts packages/core/src/server/routes/__tests__/tags.test.ts packages/core/src/server/routes/index.ts packages/core/src/server/index.ts
git commit -m "feat(core): tag CRUD + chat-tags HTTP routes"
```

---

## Task 9: Filtered chat list endpoint

**Files:**
- Modify: `packages/core/src/db/chats.ts` — add `listFiltered`
- Modify: `packages/core/src/server/routes/chats.ts` — extend `GET /api/chats`
- Test: `packages/core/src/server/routes/__tests__/chats.test.ts` (extend or create)

- [ ] **Step 1: Write the failing test**

Test the route directly, asserting AND combination across `tags` + `synthetic`:

```ts
it('GET /api/chats?tags=feature&synthetic=has-pr returns AND filter', async () => {
  // Setup: 3 chats, only one tagged feature AND has worktree+PR
  // ... seed via repos
  const res = await request(app).get('/api/chats?tags=feature&synthetic=has-pr');
  expect(res.status).toBe(200);
  expect(res.body.data.map((c: any) => c.id)).toEqual(['c-target']);
});
```

(Adapt seeding to the existing test pattern in this file. If the file doesn't exist, create it following the pattern in `routes/__tests__/auth.test.ts` for app construction.)

- [ ] **Step 2: Run test (should fail)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- routes/__tests__/chats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `listFiltered` to ChatsRepository**

In `packages/core/src/db/chats.ts`, add a new method:

```ts
interface ListFilters {
  projectId?: string;
  tagsAll?: string[];          // AND-intersect across these user tags
  syntheticAll?: ('has-pr' | 'has-worktree')[];
}

listFiltered(filters: ListFilters): Chat[] {
  const where: string[] = ["status != 'archived'"];
  const params: unknown[] = [];

  if (filters.projectId) {
    where.push('project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.syntheticAll?.includes('has-worktree')) {
    where.push('worktree_path IS NOT NULL');
  }
  if (filters.syntheticAll?.includes('has-pr')) {
    // PR detection in mainframe lives on chat.created_pr_url-equivalent fields.
    // If the column name differs, adjust here. Fallback: check via an exists join
    // with whatever PR table is in use.
    where.push('created_pr_url IS NOT NULL');
  }

  if (filters.tagsAll && filters.tagsAll.length > 0 && this.chatTags) {
    const ids = this.chatTags.filterChatIds(filters.tagsAll);
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    where.push(`id IN (${placeholders})`);
    params.push(...ids);
  }

  // Reuse the existing SELECT projection from list(); extract it into a constant
  // CHAT_SELECT_FIELDS so both methods share it. (Refactor inline: pull the column
  // list out of the existing list() query into a local const, reuse here.)
  const sql = `
    SELECT ${CHAT_SELECT_FIELDS}
    FROM chats
    WHERE ${where.join(' AND ')}
    ORDER BY pinned DESC, updated_at DESC
  `;
  const rows = this.db.prepare(sql).all(...params) as RawChatRow[];
  const chats = rows.map(/* same mapping as list() */);
  if (this.chatTags && chats.length > 0) {
    const tagsByChat = this.chatTags.bulkForChats(chats.map((c) => c.id));
    for (const c of chats) c.tags = tagsByChat.get(c.id) ?? [];
  }
  return chats;
}
```

Pull the existing column list from `list()` into a top-of-file `const CHAT_SELECT_FIELDS = '...'` and use it in both `list()` and `listFiltered()` — DRY rule.

**Important**: confirm the actual PR column name on `chats`. If PR detection is via a separate table or via `created_pr_url` doesn't exist, replace the `has-pr` predicate with the right join. Search core for where the PR URL is read on a chat to confirm.

- [ ] **Step 4: Extend `GET /api/chats`**

In `packages/core/src/server/routes/chats.ts`, replace the existing `/api/chats` handler:

```ts
const ListQuery = z.object({
  project: z.string().optional(),
  tags: z.string().optional(),       // comma-separated user tags
  synthetic: z.string().optional(),  // comma-separated, allowed: has-pr, has-worktree
});

router.get('/api/chats', (req: Request, res: Response) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.message });
    return;
  }
  const tagsAll = parsed.data.tags ? parsed.data.tags.split(',').filter(Boolean) : undefined;
  const synthRaw = parsed.data.synthetic ? parsed.data.synthetic.split(',').filter(Boolean) : [];
  const allowed = new Set(['has-pr', 'has-worktree']);
  const syntheticAll = synthRaw.filter((s) => allowed.has(s)) as ('has-pr' | 'has-worktree')[];
  const chats = ctx.chats.listFiltered({
    projectId: parsed.data.project,
    tagsAll,
    syntheticAll: syntheticAll.length > 0 ? syntheticAll : undefined,
  });
  res.json({ success: true, data: chats });
});
```

`ctx.chats.listFiltered` should be exposed by `ChatManager` (which currently wraps `db.chats.listAllChats()`); add a method there that simply delegates to `db.chats.listFiltered`. Verify the method name on `ChatManager` matches what the routes expect.

- [ ] **Step 5: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- routes/__tests__/chats.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/chats.ts packages/core/src/server/routes/chats.ts packages/core/src/server/routes/__tests__/chats.test.ts
git commit -m "feat(core): listFiltered chats endpoint with tag + synthetic AND"
```

---

## Task 10: Frontend API client

**Files:**
- Create: `packages/desktop/src/renderer/lib/api/tags-api.ts`
- Modify: `packages/desktop/src/renderer/lib/api/index.ts`

- [ ] **Step 1: Write the file**

Create `packages/desktop/src/renderer/lib/api/tags-api.ts`:

```ts
import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { API_BASE } from './http';
import { createLogger } from '../logger';

const log = createLogger('renderer:api:tags');

export async function listTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/api/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}

export async function createTag(name: string, color?: TagColor): Promise<Tag> {
  log.info('createTag', { name, color });
  const res = await fetch(`${API_BASE}/api/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()).data;
}

export async function updateTag(name: string, patch: { rename?: string; color?: TagColor }): Promise<Tag> {
  log.info('updateTag', { name, patch });
  const res = await fetch(`${API_BASE}/api/tags/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}

export async function deleteTag(name: string): Promise<void> {
  log.info('deleteTag', { name });
  const res = await fetch(`${API_BASE}/api/tags/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function getChatTags(chatId: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}

export async function setChatTags(chatId: string, tags: string[]): Promise<string[]> {
  log.info('setChatTags', { chatId, tags });
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}
```

- [ ] **Step 2: Re-export**

In `packages/desktop/src/renderer/lib/api/index.ts`, add:

```ts
export * from './tags-api';
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/tags-api.ts packages/desktop/src/renderer/lib/api/index.ts
git commit -m "feat(desktop): tag api client"
```

---

## Task 11: Tags Zustand store

**Files:**
- Create: `packages/desktop/src/renderer/store/tags.ts`
- Test: `packages/desktop/src/renderer/store/tags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTagsStore } from './tags';

vi.mock('../lib/api/tags-api', () => ({
  listTags: vi.fn().mockResolvedValue([{ name: 'feature', color: 'blue', createdAt: 'x' }]),
  setChatTags: vi.fn().mockResolvedValue(['feature']),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  updateTag: vi.fn(),
  getChatTags: vi.fn(),
}));

describe('tags store', () => {
  beforeEach(() => {
    useTagsStore.setState({
      registry: [],
      registryLoaded: false,
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
      selectedProject: null,
    });
  });

  it('refreshRegistry hydrates the registry', async () => {
    await useTagsStore.getState().refreshRegistry();
    expect(useTagsStore.getState().registry.map((t) => t.name)).toEqual(['feature']);
    expect(useTagsStore.getState().registryLoaded).toBe(true);
  });

  it('toggleTag adds and removes from selectedTags', () => {
    useTagsStore.getState().toggleTag('feature');
    expect(useTagsStore.getState().selectedTags.has('feature')).toBe(true);
    useTagsStore.getState().toggleTag('feature');
    expect(useTagsStore.getState().selectedTags.has('feature')).toBe(false);
  });

  it('clearFilters resets selection but not registry', async () => {
    await useTagsStore.getState().refreshRegistry();
    useTagsStore.getState().toggleTag('feature');
    useTagsStore.getState().clearFilters();
    expect(useTagsStore.getState().selectedTags.size).toBe(0);
    expect(useTagsStore.getState().registry.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test (should fail — store not created)**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- store/tags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement store**

Create `packages/desktop/src/renderer/store/tags.ts`:

```ts
import { create } from 'zustand';
import type { Tag, SyntheticTag } from '@qlan-ro/mainframe-types';
import { listTags, setChatTags as apiSetChatTags } from '../lib/api/tags-api';
import { createLogger } from '../lib/logger';

const log = createLogger('store:tags');

interface TagsState {
  registry: Tag[];
  registryLoaded: boolean;

  selectedProject: string | null; // null = "All"
  selectedTags: Set<string>;
  selectedSynthetic: Set<SyntheticTag>;

  refreshRegistry: () => Promise<void>;
  toggleTag: (name: string) => void;
  toggleSynthetic: (name: SyntheticTag) => void;
  setSelectedProject: (id: string | null) => void;
  clearFilters: () => void;

  applyToChat: (chatId: string, tags: string[]) => Promise<void>;
}

export const useTagsStore = create<TagsState>((set, get) => ({
  registry: [],
  registryLoaded: false,
  selectedProject: null,
  selectedTags: new Set(),
  selectedSynthetic: new Set(),

  async refreshRegistry() {
    try {
      const registry = await listTags();
      set({ registry, registryLoaded: true });
    } catch (err) {
      log.warn('refreshRegistry failed', { err: String(err) });
    }
  },

  toggleTag(name: string) {
    const next = new Set(get().selectedTags);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    set({ selectedTags: next });
  },

  toggleSynthetic(name: SyntheticTag) {
    const next = new Set(get().selectedSynthetic);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    set({ selectedSynthetic: next });
  },

  setSelectedProject(id: string | null) {
    set({ selectedProject: id });
  },

  clearFilters() {
    set({
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
      selectedProject: null,
    });
  },

  async applyToChat(chatId: string, tags: string[]) {
    try {
      await apiSetChatTags(chatId, tags);
      // Caller (chats store) updates the Chat row with the new tags array.
      await get().refreshRegistry();
    } catch (err) {
      log.warn('applyToChat failed', { err: String(err) });
      throw err;
    }
  },
}));
```

- [ ] **Step 4: Run test (should pass)**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- store/tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/store/tags.ts packages/desktop/src/renderer/store/tags.test.ts
git commit -m "feat(desktop): tags store"
```

---

## Task 12: TagPill component

**Files:**
- Create: `packages/desktop/src/renderer/components/tags/TagPill.tsx`

- [ ] **Step 1: Add palette → Tailwind class map**

In `TagPill.tsx`:

```tsx
import React from 'react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { cn } from '../../lib/utils';

const COLOR_BG: Record<TagColor, string> = {
  blue: 'bg-mf-tag-blue text-white',
  red: 'bg-mf-tag-red text-white',
  purple: 'bg-mf-tag-purple text-white',
  violet: 'bg-mf-tag-violet text-white',
  amber: 'bg-mf-tag-amber text-black',
  teal: 'bg-mf-tag-teal text-white',
  cyan: 'bg-mf-tag-cyan text-black',
  green: 'bg-mf-tag-green text-white',
  pink: 'bg-mf-tag-pink text-white',
  orange: 'bg-mf-tag-orange text-white',
};

const COLOR_DOT: Record<TagColor | 'gray', string> = {
  blue: 'bg-mf-tag-blue',
  red: 'bg-mf-tag-red',
  purple: 'bg-mf-tag-purple',
  violet: 'bg-mf-tag-violet',
  amber: 'bg-mf-tag-amber',
  teal: 'bg-mf-tag-teal',
  cyan: 'bg-mf-tag-cyan',
  green: 'bg-mf-tag-green',
  pink: 'bg-mf-tag-pink',
  orange: 'bg-mf-tag-orange',
  gray: 'bg-mf-text-secondary',
};

interface Props {
  label: string;
  color: TagColor | 'gray';
  variant: 'row' | 'filter';
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function TagPill({ label, color, variant, active, onClick, onContextMenu }: Props): React.ReactElement {
  if (variant === 'row') {
    const cls = color === 'gray' ? 'bg-mf-text-secondary text-white' : COLOR_BG[color as TagColor];
    return (
      <span
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded-full text-mf-status font-medium cursor-pointer',
          cls,
        )}
      >
        {label}
      </span>
    );
  }
  // filter
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-mf-status border transition-colors',
        active
          ? 'border-mf-accent bg-mf-hover text-mf-text-primary'
          : 'border-mf-border-subtle text-mf-text-secondary hover:bg-mf-hover/50',
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', COLOR_DOT[color])} />
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Add `mf-tag-*` Tailwind tokens if missing**

Search for existing `mf-tag-*` tokens:

```bash
grep -r "mf-tag-" packages/desktop/src/
```

If none exist, add them to the Tailwind config / CSS variable definitions used by the design system. Pick palette hex values that align with existing `mf-accent` and friends. Mind the memory rule: never use `/opacity` modifiers with these — they are hex CSS variables and the modifier silently fails.

- [ ] **Step 3: Build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/tags/TagPill.tsx packages/desktop/src/renderer/styles
git commit -m "feat(desktop): TagPill component with row + filter variants"
```

---

## Task 13: TagPopover component

**Files:**
- Create: `packages/desktop/src/renderer/components/tags/TagPopover.tsx`

- [ ] **Step 1: Implement popover**

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Tag } from '@qlan-ro/mainframe-types';
import { useTagsStore } from '../../store/tags';
import { useChatsStore } from '../../store';
import { cn } from '../../lib/utils';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:tag-popover');

interface Props {
  chatId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

export function TagPopover({ chatId, anchorRect, onClose }: Props): React.ReactElement {
  const registry = useTagsStore((s) => s.registry);
  const refreshRegistry = useTagsStore((s) => s.refreshRegistry);
  const applyToChat = useTagsStore((s) => s.applyToChat);

  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const updateChat = useChatsStore((s) => s.updateChat);

  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshRegistry();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [refreshRegistry]);

  const lower = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lower) return registry;
    return registry.filter((t) => t.name.includes(lower));
  }, [registry, lower]);

  const exactMatch = useMemo(() => registry.some((t) => t.name === lower), [registry, lower]);
  const showCreate = lower.length > 0 && !exactMatch;

  const applied = new Set(chat?.tags ?? []);

  async function toggle(name: string) {
    if (!chat) return;
    setError(null);
    const next = new Set(applied);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    const arr = [...next];
    updateChat({ ...chat, tags: arr }); // optimistic
    try {
      await applyToChat(chat.id, arr);
    } catch (err) {
      updateChat({ ...chat, tags: chat.tags }); // rollback
      setError(String((err as Error).message));
    }
  }

  async function createAndApply() {
    if (!chat || !lower) return;
    setError(null);
    const next = [...(chat.tags ?? []), lower];
    updateChat({ ...chat, tags: next });
    try {
      await applyToChat(chat.id, next);
      setQuery('');
    } catch (err) {
      updateChat({ ...chat, tags: chat.tags });
      setError(String((err as Error).message));
    }
  }

  return (
    <div
      role="dialog"
      style={{ position: 'fixed', left: anchorRect.left, top: anchorRect.bottom + 4 }}
      className="z-50 w-64 rounded-mf-input border border-mf-border-subtle bg-mf-panel-bg shadow-lg p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-mf-status text-mf-text-secondary uppercase tracking-wide px-2 py-1">Tag session</div>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && showCreate) void createAndApply();
        }}
        placeholder="# Find or create..."
        className="w-full bg-mf-bg text-mf-small px-2 py-1 rounded outline-none border border-mf-border-subtle"
      />
      {error && <div className="text-mf-status text-mf-destructive px-2 py-1">{error}</div>}
      <div className="max-h-64 overflow-y-auto mt-1">
        {filtered.map((t: Tag) => (
          <button
            key={t.name}
            type="button"
            onClick={() => void toggle(t.name)}
            className={cn(
              'w-full flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-mf-hover text-mf-small',
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn('w-1.5 h-1.5 rounded-full', `bg-mf-tag-${t.color}`)} />
              {t.name}
            </span>
            {applied.has(t.name) && <Check size={12} className="text-mf-accent" />}
          </button>
        ))}
      </div>
      {showCreate && (
        <button
          type="button"
          onClick={() => void createAndApply()}
          className="w-full text-left px-2 py-1 rounded hover:bg-mf-hover text-mf-small text-mf-text-secondary mt-1 border-t border-mf-border-subtle"
        >
          + Create tag &quot;{lower}&quot;
        </button>
      )}
    </div>
  );
}
```

The popover closes via parent click-outside handling — host site responsibility (FlatSessionRow / ChatsPanel uses `useEffect` + `mousedown` listener to call `onClose`).

- [ ] **Step 2: Build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/tags/TagPopover.tsx
git commit -m "feat(desktop): TagPopover with search + create"
```

---

## Task 14: SessionFilterBar component

**Files:**
- Create: `packages/desktop/src/renderer/components/panels/SessionFilterBar.tsx`

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useMemo } from 'react';
import { useTagsStore } from '../../store/tags';
import { useChatsStore, useProjectsStore } from '../../store';
import { TagPill } from '../tags/TagPill';
import type { TagColor, SyntheticTag } from '@qlan-ro/mainframe-types';

export function SessionFilterBar(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const chats = useChatsStore((s) => s.chats);

  const registry = useTagsStore((s) => s.registry);
  const registryLoaded = useTagsStore((s) => s.registryLoaded);
  const refreshRegistry = useTagsStore((s) => s.refreshRegistry);

  const selectedProject = useTagsStore((s) => s.selectedProject);
  const selectedTags = useTagsStore((s) => s.selectedTags);
  const selectedSynthetic = useTagsStore((s) => s.selectedSynthetic);
  const setSelectedProject = useTagsStore((s) => s.setSelectedProject);
  const toggleTag = useTagsStore((s) => s.toggleTag);
  const toggleSynthetic = useTagsStore((s) => s.toggleSynthetic);

  useEffect(() => {
    if (!registryLoaded) void refreshRegistry();
  }, [registryLoaded, refreshRegistry]);

  // Tags currently in use across the active project scope.
  const tagsInUse = useMemo(() => {
    const visibleChats = selectedProject
      ? chats.filter((c) => c.projectId === selectedProject)
      : chats;
    const set = new Set<string>();
    for (const c of visibleChats) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [chats, selectedProject]);

  const hasAnyWorktree = useMemo(() => chats.some((c) => Boolean(c.worktreePath)), [chats]);
  const hasAnyPr = useMemo(
    () => chats.some((c) => Boolean((c as { createdPrUrl?: string }).createdPrUrl)),
    [chats],
  );

  const colorByName = useMemo(() => {
    const m = new Map<string, TagColor>();
    for (const t of registry) m.set(t.name, t.color);
    return m;
  }, [registry]);

  const showTagsRow = tagsInUse.length > 0 || hasAnyWorktree || hasAnyPr;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 border-b border-mf-border-subtle">
      <div className="flex items-center gap-1 overflow-x-auto">
        <span className="text-mf-status text-mf-text-secondary uppercase mr-1">Project</span>
        <button
          type="button"
          onClick={() => setSelectedProject(null)}
          className={`px-2 py-0.5 rounded-full text-mf-status ${selectedProject === null ? 'bg-mf-accent text-white' : 'border border-mf-border-subtle text-mf-text-secondary'}`}
        >
          All
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedProject(p.id)}
            className={`px-2 py-0.5 rounded-full text-mf-status ${selectedProject === p.id ? 'bg-mf-accent text-white' : 'border border-mf-border-subtle text-mf-text-secondary'}`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {showTagsRow && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-mf-status text-mf-text-secondary uppercase mr-1">Tags</span>
          {tagsInUse.map((name) => (
            <TagPill
              key={name}
              label={name}
              color={colorByName.get(name) ?? 'gray'}
              variant="filter"
              active={selectedTags.has(name)}
              onClick={() => toggleTag(name)}
            />
          ))}
          {hasAnyPr && (
            <TagPill
              label="has-pr"
              color="gray"
              variant="filter"
              active={selectedSynthetic.has('has-pr')}
              onClick={() => toggleSynthetic('has-pr' as SyntheticTag)}
            />
          )}
          {hasAnyWorktree && (
            <TagPill
              label="has-worktree"
              color="gray"
              variant="filter"
              active={selectedSynthetic.has('has-worktree')}
              onClick={() => toggleSynthetic('has-worktree' as SyntheticTag)}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

The filter logic itself (applying selection to the visible list) is wired in `ChatsPanel` (Task 16) since this component is presentational.

- [ ] **Step 2: Build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/SessionFilterBar.tsx
git commit -m "feat(desktop): SessionFilterBar component"
```

---

## Task 15: Refactor FlatSessionRow

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx`

- [ ] **Step 1: Move worktree pill + PR badge into title row, add tag row**

Replace the existing `<div>` returned in the component (currently with `data-testid="chat-list-item"`) with the structure below. Keep all existing handlers (`handleSelect`, `handleArchive`, `handleStartRename`, `handleCommitRename`, etc.) untouched.

Add:

```tsx
import { Tag as TagIcon } from 'lucide-react';
import { TagPill } from '../tags/TagPill';
import { TagPopover } from '../tags/TagPopover';
import { useTagsStore } from '../../store/tags';
```

Inside the component, add popover state:

```tsx
const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
const tagButtonRef = useRef<HTMLButtonElement>(null);

const openTagPopover = useCallback((e: React.MouseEvent) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  setPopoverRect(rect);
}, []);

const closeTagPopover = useCallback(() => setPopoverRect(null), []);

const registry = useTagsStore((s) => s.registry);
const colorOf = useCallback(
  (name: string) => registry.find((t) => t.name === name)?.color ?? 'gray',
  [registry],
);
```

Then the JSX (replacing the existing return body):

```tsx
return (
  <div
    data-testid="chat-list-item"
    onContextMenu={(e) => onContextMenu?.(e, chat.claudeSessionId, chat.id)}
    className={cn(
      'group w-full rounded-mf-input transition-colors',
      isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
    )}
  >
    <div className="flex items-center gap-2 px-3 py-1.5">
      {/* status dot — unchanged */}
      <div className="w-3 h-3 shrink-0 flex items-center justify-center">
        {chat.worktreeMissing ? (
          <div className="w-2 h-2 rounded-full bg-mf-destructive" />
        ) : isWorking ? (
          <Loader2 size={12} className="text-mf-accent animate-spin" />
        ) : (
          <div className={cn('w-2 h-2 rounded-full', isUnread ? 'bg-mf-accent' : 'bg-mf-text-secondary opacity-40')} />
        )}
      </div>

      <button type="button" onClick={handleSelect} className="flex-1 min-w-0 text-left flex items-center gap-2">
        {chat.pinned && <Pin size={10} className="shrink-0 text-mf-accent" />}
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleCommitRename}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-mf-panel-bg text-mf-small text-mf-text-primary border border-mf-accent rounded px-1 py-0 outline-none"
          />
        ) : (
          <span
            className={cn(
              'truncate text-mf-small',
              isActive ? 'text-mf-text-primary font-medium' : 'text-mf-text-secondary',
              isUnread && !isActive ? 'font-semibold text-mf-text-primary' : '',
            )}
          >
            {chat.title || 'Untitled session'}
          </span>
        )}

        {/* worktree pill */}
        {chat.worktreePath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-mf-bg border border-mf-border-subtle font-mono text-mf-status text-mf-text-secondary max-w-[140px] truncate"
                tabIndex={0}
              >
                <GitBranch size={10} className="shrink-0" />
                {chat.worktreePath.split('/').pop()}
              </span>
            </TooltipTrigger>
            <TooltipContent>{chat.worktreePath}</TooltipContent>
          </Tooltip>
        )}

        {/* PR badge */}
        {createdPrUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(createdPrUrl, '_blank');
                }}
                className="shrink-0 text-[#1a7f37] hover:opacity-70 cursor-pointer"
                aria-label="Open PR"
              >
                <GitPullRequest size={12} />
              </span>
            </TooltipTrigger>
            <TooltipContent>Open PR</TooltipContent>
          </Tooltip>
        )}
      </button>

      {/* time — visible when row not hovered */}
      <span className="shrink-0 text-mf-status text-mf-text-secondary tabular-nums group-hover:hidden">
        {formatRelativeTime(chat.updatedAt)}
      </span>

      {/* hover actions */}
      <div className={cn('shrink-0 items-center gap-0.5 hidden group-hover:flex', archiving && 'flex')}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={tagButtonRef}
              onClick={openTagPopover}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
              aria-label="Edit tags"
            >
              <TagIcon size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Tags</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStartRename}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
              aria-label="Rename session"
            >
              <Pencil size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Rename</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleArchive}
              disabled={archiving}
              className={cn(
                'w-6 h-6 rounded flex items-center justify-center text-mf-text-secondary transition-colors',
                archiving ? '' : 'hover:bg-mf-hover hover:text-mf-text-primary',
              )}
              aria-label="Archive session"
            >
              {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
      </div>
    </div>

    {/* tag row */}
    {((chat.tags && chat.tags.length > 0) || true) && (
      <div
        className={cn(
          'flex items-center gap-1 px-3 pb-1.5 flex-wrap',
          (!chat.tags || chat.tags.length === 0) && 'hidden group-hover:flex',
        )}
        onClick={openTagPopover}
      >
        {(chat.tags ?? []).map((name) => (
          <TagPill key={name} label={name} color={colorOf(name)} variant="row" />
        ))}
        {(!chat.tags || chat.tags.length === 0) && (
          <span className="text-mf-status text-mf-text-secondary opacity-60">+ tag</span>
        )}
      </div>
    )}

    {popoverRect && <TagPopover chatId={chat.id} anchorRect={popoverRect} onClose={closeTagPopover} />}
  </div>
);
```

The metadata line with `📁 project · 🌿 worktree · ⏰ time` is removed entirely.

- [ ] **Step 2: Add click-outside handling for popover**

```tsx
useEffect(() => {
  if (!popoverRect) return;
  function onDocClick() { closeTagPopover(); }
  document.addEventListener('mousedown', onDocClick);
  return () => document.removeEventListener('mousedown', onDocClick);
}, [popoverRect, closeTagPopover]);
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: succeeds.

- [ ] **Step 4: Manual sanity test**

Per CLAUDE.md UI rule: start the dev server, click a session row's tag icon, verify popover opens; right-click → context menu still appears (archive/rename/etc still work). Verify worktree pill + PR badge sit on the title row, not below.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx
git commit -m "feat(desktop): refactor FlatSessionRow — worktree+PR in title, tag row below"
```

---

## Task 16: Wire SessionFilterBar into ChatsPanel + apply filters

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx`

- [ ] **Step 1: Mount the filter bar and apply selections to the displayed list**

In `ChatsPanel.tsx`, import and render `SessionFilterBar` near the top of the panel (above the list). Then, where the chats list is built (`buildGroups` / direct list), apply the active filters.

```tsx
import { SessionFilterBar } from './SessionFilterBar';
import { useTagsStore } from '../../store/tags';
```

Inside the component, derive the filtered chats:

```tsx
const selectedProject = useTagsStore((s) => s.selectedProject);
const selectedTags = useTagsStore((s) => s.selectedTags);
const selectedSynthetic = useTagsStore((s) => s.selectedSynthetic);

const visibleChats = useMemo(() => {
  return chats.filter((c) => {
    if (c.status === 'archived') return false;
    if (selectedProject && c.projectId !== selectedProject) return false;
    if (selectedSynthetic.has('has-worktree') && !c.worktreePath) return false;
    if (selectedSynthetic.has('has-pr')) {
      const pr = (c as { createdPrUrl?: string }).createdPrUrl;
      if (!pr) return false;
    }
    if (selectedTags.size > 0) {
      const tagSet = new Set(c.tags ?? []);
      for (const t of selectedTags) if (!tagSet.has(t)) return false;
    }
    return true;
  });
}, [chats, selectedProject, selectedTags, selectedSynthetic]);
```

Where `chats` was previously fed into `buildGroups(...)` or the flat list, pass `visibleChats` instead.

Render the bar above the list:

```tsx
<>
  <SessionFilterBar />
  {/* existing list rendering, but using visibleChats */}
</>
```

If the list ends up empty due to filters, show:

```tsx
{visibleChats.length === 0 && (selectedProject || selectedTags.size > 0 || selectedSynthetic.size > 0) && (
  <div className="px-3 py-4 text-mf-small text-mf-text-secondary">
    No sessions match these filters.{' '}
    <button
      type="button"
      onClick={() => useTagsStore.getState().clearFilters()}
      className="underline hover:text-mf-text-primary"
    >
      Clear filters
    </button>
  </div>
)}
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`
Expected: succeeds.

- [ ] **Step 3: Manual sanity test**

Start the dev server. Verify:
- Project pills work (filter by project).
- Selecting a tag chip narrows the list.
- Selecting `has-pr` and `has-worktree` narrows further.
- Multi-select is strict AND.
- "No sessions match these filters" + Clear button appears when nothing matches.
- Reload the app — filters reset (no persistence).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/ChatsPanel.tsx
git commit -m "feat(desktop): mount filter bar in ChatsPanel + AND-filter chats"
```

---

## Task 17: Verification + changeset

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```
Expected: all pass.

- [ ] **Step 2: Typecheck**

```bash
pnpm build
```
Expected: succeeds in all packages.

- [ ] **Step 3: Manual regression sweep**

Per CLAUDE.md UI rule, exercise the dev app:
- Right-click a session → `Tags...` opens popover; create + apply works.
- Click the tag row of a tagged session → opens popover.
- Hover an untagged row → `+ tag` ghost appears and is clickable.
- Filter bar `Project` + `Tags` + synthetic chips combine as strict AND.
- Renaming a tag in the popover (right-click on a registry row) cascades to all sessions immediately.
- Renaming to an existing tag triggers the merge confirmation modal.
- Deleting a tag triggers the delete confirmation modal.
- Refresh the app — filter selection clears (no persistence). Tag registry persists.

- [ ] **Step 4: Add changeset**

```bash
pnpm changeset
```
Pick `@qlan-ro/mainframe-types`, `@qlan-ro/mainframe-core`, `@qlan-ro/mainframe-desktop`, bump `minor` for each. Description: "Add session row tagging with synthetic has-pr / has-worktree filter chips."

- [ ] **Step 5: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: changeset for session row tagging"
```

---

## Self-Review Notes

- The `has-pr` predicate in Task 9 references `created_pr_url` — that column may not exist on the `chats` table as named. **Implementation note for the executor:** before writing the SQL, search core for how `createdPrUrl` is populated on `Chat` (currently it's surfaced via `chats-store.detectedPrs` on the renderer side, derived from runtime detection rather than persisted). If the data isn't persisted on `chats`, either persist it (add a column + populate on PR detection) or implement `has-pr` filtering client-side only (filter on the renderer using `chatsStore.detectedPrs`, treating the API's `synthetic=has-pr` as a no-op). Pick persistence for correctness — the filter should match what the row UI shows.
- Task 15's tag-row conditional (`((chat.tags && chat.tags.length > 0) || true)`) is intentionally always true because the empty-state hover ghost needs the row in the DOM. The CSS class `hidden group-hover:flex` handles visibility.
- Tasks 13 and 15 reuse `Chat.tags` from the chat store. The chats store needs no changes because `updateChat` already merges arbitrary `Chat` fields — the `tags` field flows through automatically.
- **Right-click on a registry row inside the popover → Rename / Recolor / Delete** is in the spec but not in Task 13's code. The executor should add it as a follow-on inside Task 13: a context-menu handler on each row that opens a small menu, with confirmation modals for rename (with merge prompt when the new name already exists) and delete. If this stretches Task 13 too far, split into Task 13a (popover core) + Task 13b (registry management).
- **Right-click context menu item on the session row** ("Tags...") is in the spec but not added to the existing `ChatsPanel` context-menu builder. The executor should add it: in `ChatsPanel.tsx`'s `onContextMenu` handler that builds `ContextMenuItem[]`, prepend a `Tags...` action that triggers the same popover-open path as the hover icon (Task 15). This lets `onContextMenu` continue to delegate to the parent without `FlatSessionRow` owning the menu shape.
