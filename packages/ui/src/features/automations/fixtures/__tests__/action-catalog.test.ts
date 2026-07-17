/**
 * ACTION_CATALOG_FIXTURE — UI-authored `ActionCatalogEntry[]` for the nine
 * launch actions (contract §5). No Node fixture exists for this yet (only
 * automation definitions are canonical JSON, contract §8) — this table is
 * UI-owned scaffolding for ActionCatalog/AutoForm, since replaced by a live
 * `/api/automation-actions` response. TDD: test written first, implemented
 * after.
 */
import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG_FIXTURE } from '../action-catalog';

const CONTRACT_ACTION_IDS = [
  'run_command',
  'files.append',
  'files.write',
  'files.read',
  'http.request',
  'github.create_pr',
  'github.list_prs',
  'notion.add_row',
  'ado.create_item',
];

describe('ACTION_CATALOG_FIXTURE', () => {
  it('has exactly one entry per contract §5 action id, split files.append/write/read', () => {
    expect(ACTION_CATALOG_FIXTURE.map((a) => a.id).sort()).toEqual([...CONTRACT_ACTION_IDS].sort());
  });

  it('carries no mcp:* entries at launch (contract §9: MCP deferred, flag off)', () => {
    expect(ACTION_CATALOG_FIXTURE.some((a) => a.group === 'mcp')).toBe(false);
  });
});
