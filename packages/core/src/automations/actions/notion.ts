// packages/core/src/automations/actions/notion.ts
//
// Curated connector (Task 15). No schema-lookup endpoint exists yet for
// per-column Notion property types (contract §9 "under-built product
// surfaces"), so every non-databaseId param is sent as a rich_text property
// — the params record is already flat key/value ChipText output, not a
// typed Notion schema.
import { z } from 'zod';
import type { ActionDef } from './types.js';

const NOTION_API = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';

const AddRowInputSchema = z.object({ databaseId: z.string().min(1) }).catchall(z.string());

export const notionAddRowAction: ActionDef = {
  id: 'notion.add_row',
  title: 'Notion: add database row',
  group: 'connector',
  auth: 'token',
  credentialLabelHint: 'notion',
  input: AddRowInputSchema,
  outputs: [{ name: 'pageUrl', type: 'text' }],
  idempotent: false,
  async run(ctx, rawInput) {
    const { databaseId, ...properties } = AddRowInputSchema.parse(rawInput);
    const notionProperties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, { rich_text: [{ text: { content: value } }] }]),
    );
    const res = await fetch(NOTION_API, {
      method: 'POST',
      headers: {
        ...(ctx.creds?.token ? { Authorization: `Bearer ${ctx.creds.token}` } : {}),
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: databaseId }, properties: notionProperties }),
      signal: ctx.signal,
    });
    if (res.status >= 400) {
      const body = await res.text();
      throw new Error(`Notion add row failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as { url: string };
    return { pageUrl: json.url };
  },
};
