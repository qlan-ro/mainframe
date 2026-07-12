// packages/core/src/automations/actions/ado.ts
//
// Curated connector (Task 15). Azure DevOps auths via PAT basic auth
// (`:<token>` base64), not Bearer — the work item type is a URL path
// segment prefixed with `$` per the ADO REST API.
import { z } from 'zod';
import type { ActionDef } from './types.js';

const CreateItemInputSchema = z
  .object({
    org: z.string().min(1),
    project: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    description: z.string().default(''),
  })
  .strict();

interface AdoWorkItem {
  id: number;
  _links: { html: { href: string } };
}

export const adoCreateItemAction: ActionDef = {
  id: 'ado.create_item',
  title: 'Azure DevOps: create work item',
  group: 'connector',
  auth: 'token',
  credentialLabelHint: 'ado',
  input: CreateItemInputSchema,
  outputs: [
    { name: 'workItemId', type: 'number' },
    { name: 'url', type: 'text' },
  ],
  idempotent: false,
  async run(ctx, rawInput) {
    const input = CreateItemInputSchema.parse(rawInput);
    const url = `https://dev.azure.com/${input.org}/${input.project}/_apis/wit/workitems/$${input.type}?api-version=7.1`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...(ctx.creds?.token
          ? { Authorization: `Basic ${Buffer.from(`:${ctx.creds.token}`).toString('base64')}` }
          : {}),
        'Content-Type': 'application/json-patch+json',
      },
      body: JSON.stringify([
        { op: 'add', path: '/fields/System.Title', value: input.title },
        { op: 'add', path: '/fields/System.Description', value: input.description },
      ]),
      signal: ctx.signal,
    });
    if (res.status >= 400) {
      const body = await res.text();
      throw new Error(`Azure DevOps create item failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as AdoWorkItem;
    return { workItemId: json.id, url: json._links.html.href };
  },
};
