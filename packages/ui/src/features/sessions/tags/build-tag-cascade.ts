/**
 * Pure cascade-mirror math (spec §5.5).
 *
 * Registry PATCH/DELETE /api/tags/:name cascade in SQLite but emit NO
 * chat.updated for affected chats, so the client must rewrite custom.tags
 * across loaded threads on rename/delete. `to === null` ⇒ delete (drop the
 * tag); a string ⇒ rename (replace + dedupe). Recolor never calls this.
 * Only threads that actually carry `from` produce an update.
 */
export interface TagCascadeUpdate {
  id: string;
  newTags: string[];
}

export interface ThreadTagSnapshot {
  id: string;
  custom: { tags: string[] };
}

export function buildTagCascade(threads: ThreadTagSnapshot[], from: string, to: string | null): TagCascadeUpdate[] {
  const updates: TagCascadeUpdate[] = [];
  for (const t of threads) {
    if (!t.custom.tags.includes(from)) continue;
    const newTags =
      to === null
        ? t.custom.tags.filter((x) => x !== from)
        : Array.from(new Set(t.custom.tags.map((x) => (x === from ? to : x))));
    updates.push({ id: t.id, newTags });
  }
  return updates;
}
