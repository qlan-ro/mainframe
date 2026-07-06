import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { WorkflowDb } from './db.js';
import type { WorkflowDef } from './dsl/types.js';
import { parseWorkflowYaml } from './dsl/parse.js';
import { verifyWorkflow } from './dsl/verify.js';

export interface LoadedWorkflow {
  id: string; // '{projectId|global}:{name}'
  name: string;
  projectId: string | null;
  filePath: string;
  definition: WorkflowDef;
}

export interface ScanResult {
  loaded: LoadedWorkflow[];
  errors: Array<{ file: string; error: string }>;
}

export class WorkflowLoader {
  constructor(
    private readonly db: WorkflowDb,
    private readonly logger: Logger,
  ) {}

  async scanDir(dirPath: string, projectId: string | null): Promise<ScanResult> {
    const result: ScanResult = { loaded: [], errors: [] };
    const files = await this.listYamlFiles(dirPath);
    for (const file of files) {
      const filePath = join(dirPath, file);
      await this.loadFile(filePath, projectId, result);
    }
    return result;
  }

  list(): LoadedWorkflow[] {
    const rows = this.db.prepare(`SELECT * FROM workflow_defs ORDER BY name`).all() as Array<{
      id: string;
      name: string;
      project_id: string | null;
      file_path: string;
      definition: string;
    }>;
    return rows.map(rowToWorkflow);
  }

  get(id: string): LoadedWorkflow | null {
    return this.list().find((w) => w.id === id) ?? null;
  }

  /** Project-scoped lookup falls back to global — used by `call` steps and event triggers. */
  findByName(name: string, projectId: string | null): LoadedWorkflow | null {
    if (projectId) {
      const scoped = this.get(`${projectId}:${name}`);
      if (scoped) return scoped;
    }
    return this.get(`global:${name}`);
  }

  private async listYamlFiles(dirPath: string): Promise<string[]> {
    try {
      const all = await readdir(dirPath);
      return all.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    } catch (err) {
      // Missing dir is expected for projects without workflows — treat as empty.
      this.logger.debug({ dirPath, err: String(err) }, 'workflow dir missing or unreadable'); /* expected */
      return [];
    }
  }

  private async loadFile(filePath: string, projectId: string | null, result: ScanResult): Promise<void> {
    try {
      const yaml = await readFile(filePath, 'utf8');
      const def = parseWorkflowYaml(yaml);
      const verifyErrors = verifyWorkflow(def);
      if (verifyErrors.length > 0) {
        throw new Error(verifyErrors.map((e) => e.message).join('; '));
      }
      const id = `${projectId ?? 'global'}:${def.name}`;
      upsertDefinition(this.db, id, def.name, projectId, filePath, def);
      result.loaded.push({ id, name: def.name, projectId, filePath, definition: def });
    } catch (err) {
      const error = String(err instanceof Error ? err.message : err);
      this.logger.warn({ filePath, error }, 'workflow file skipped');
      result.errors.push({ file: filePath, error });
    }
  }
}

function upsertDefinition(
  db: WorkflowDb,
  id: string,
  name: string,
  projectId: string | null,
  filePath: string,
  def: WorkflowDef,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO workflow_defs (id, name, project_id, file_path, definition, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, projectId, filePath, JSON.stringify(def), new Date().toISOString());
}

function rowToWorkflow(r: {
  id: string;
  name: string;
  project_id: string | null;
  file_path: string;
  definition: string;
}): LoadedWorkflow {
  return {
    id: r.id,
    name: r.name,
    projectId: r.project_id,
    filePath: r.file_path,
    definition: JSON.parse(r.definition) as WorkflowDef,
  };
}
