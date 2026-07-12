// packages/core/src/automations/actions/register-all.ts
//
// Task 23. Every builtin + curated action registers here — the MCP catalog
// (group:'mcp') is a post-launch addition behind AUTOMATIONS_MCP_ENABLED and
// is not wired by this function.
import { filesAppendAction, filesReadAction, filesWriteAction } from './files.js';
import { httpRequestAction } from './http.js';
import { runCommandAction } from './run-command.js';
import { githubCreatePrAction, githubListPrsAction } from './github.js';
import { notionAddRowAction } from './notion.js';
import { adoCreateItemAction } from './ado.js';
import type { ActionRegistry } from './registry.js';

export function registerAllActions(registry: ActionRegistry): void {
  registry.register(runCommandAction);
  registry.register(filesAppendAction);
  registry.register(filesWriteAction);
  registry.register(filesReadAction);
  registry.register(httpRequestAction);
  registry.register(githubCreatePrAction);
  registry.register(githubListPrsAction);
  registry.register(notionAddRowAction);
  registry.register(adoCreateItemAction);
}
