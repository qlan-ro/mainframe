/**
 * ACTION_CATALOG_FIXTURE — UI-authored `ActionCatalogEntry[]` for the nine
 * launch actions (contract §5). No Node fixture exists for this yet (only
 * automation definitions are canonical JSON, contract §8) — this table is
 * UI-owned scaffolding for Phase 4's ActionCatalog/AutoForm, replaced by a
 * live `/api/automation-actions` response in Phase 6. TDD: test written
 * first, implemented after.
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

  it('matches contract §5 output tables for a representative sample', () => {
    const runCommand = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'run_command');
    expect(runCommand?.outputs).toEqual([
      { name: 'output', type: 'text' },
      { name: 'exitCode', type: 'number' },
    ]);
    const filesRead = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'files.read');
    expect(filesRead?.outputs).toEqual([{ name: 'content', type: 'text' }]);
    const filesAppend = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'files.append');
    expect(filesAppend?.outputs).toEqual([]);
    const listPrs = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'github.list_prs');
    expect(listPrs?.outputs).toEqual([{ name: 'prs', type: 'list' }]);
  });

  it('marks connector actions auth: token with a credentialLabelHint; builtins (except http) auth: none', () => {
    const runCommand = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'run_command');
    expect(runCommand?.auth).toBe('none');
    const githubPr = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'github.create_pr');
    expect(githubPr?.auth).toBe('token');
    expect(githubPr?.credentialLabelHint).toBe('GitHub');
    const notion = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'notion.add_row');
    expect(notion?.credentialLabelHint).toBe('Notion');
    const ado = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'ado.create_item');
    expect(ado?.credentialLabelHint).toBe('Azure DevOps');
  });

  it('run_command declares hasOutputAs on its paramsSchema (Text/Lines segment, patches step.outputAs)', () => {
    const runCommand = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'run_command');
    expect((runCommand?.paramsSchema as { hasOutputAs?: boolean }).hasOutputAs).toBe(true);
  });

  it("notion.add_row's columns field is keyed off databaseId with a per-database column lookup", () => {
    const notion = ACTION_CATALOG_FIXTURE.find((a) => a.id === 'notion.add_row');
    const schema = notion?.paramsSchema as {
      fields: Array<{
        key: string;
        control: string;
        columnsSourceKey?: string;
        columnsByOption?: Record<string, string[]>;
      }>;
    };
    const columnsField = schema.fields.find((f) => f.control === 'columns');
    expect(columnsField?.columnsSourceKey).toBe('databaseId');
    expect(columnsField?.columnsByOption?.['Health Log']).toEqual(['Date', 'Mood', 'Sleep', 'Symptoms']);
  });

  it('files.append and files.write both declare path + content fields; files.read declares path only', () => {
    const schemaFieldKeys = (id: string) => {
      const entry = ACTION_CATALOG_FIXTURE.find((a) => a.id === id);
      const schema = entry?.paramsSchema as { fields: Array<{ key: string }> };
      return schema.fields.map((f) => f.key);
    };
    expect(schemaFieldKeys('files.append')).toEqual(['path', 'content']);
    expect(schemaFieldKeys('files.write')).toEqual(['path', 'content']);
    expect(schemaFieldKeys('files.read')).toEqual(['path']);
  });
});
