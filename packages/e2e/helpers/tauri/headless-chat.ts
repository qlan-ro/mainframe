import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { DAEMON_PORT } from '../../fixtures/daemon.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;
const DEFAULT_CLAUDE_MD =
  '# E2E Test Project\n\nAutomated test environment. Do not use plan mode. Execute tool calls directly.\n';

export interface HeadlessProject {
  projectPath: string;
  projectId: string;
}

/**
 * REST-only sibling of `setup.ts`'s `createTauriProject`/`createTauriChat`, for specs that
 * assert on raw WS frames and never open a `page` (todo #350 group H). Project/chat creation
 * is identical to the page-driven helpers minus the UI wait, since nothing here needs the
 * app to have rendered a sidebar row.
 */
export async function createHeadlessProject(): Promise<HeadlessProject> {
  const tmpBase = path.join(homedir(), 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  const projectPath = realpathSync(mkdtempSync(path.join(tmpBase, 'mf-e2e-')));
  execSync(
    'git init -b main && git -c user.email=e2e@mainframe.test -c user.name="Mainframe E2E" commit --allow-empty -m "init"',
    { cwd: projectPath, stdio: 'pipe' },
  );
  writeFileSync(path.join(projectPath, 'CLAUDE.md'), DEFAULT_CLAUDE_MD);

  const res = await fetch(`${DAEMON_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectPath, name: path.basename(projectPath) }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`createHeadlessProject: POST /api/projects failed (${res.status} ${await res.text()})`);
  }
  const body = (await res.json()) as { data?: { id?: string } };
  const projectId = body.data?.id;
  if (!projectId) throw new Error(`createHeadlessProject: no project id (${JSON.stringify(body)})`);
  return { projectPath, projectId };
}

export async function createHeadlessChat(
  projectId: string,
  adapterId = 'mock-cli',
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'yolo' = 'default',
): Promise<string> {
  const res = await fetch(`${DAEMON_BASE}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, adapterId, permissionMode }),
  });
  if (!res.ok) throw new Error(`createHeadlessChat: POST /api/chats failed (${res.status} ${await res.text()})`);
  const created = (await res.json()) as { data?: { id?: string } };
  const chatId = created.data?.id;
  if (!chatId) throw new Error(`createHeadlessChat: no chat id (${JSON.stringify(created)})`);
  return chatId;
}

export function cleanupHeadlessProject(project?: HeadlessProject): void {
  if (!project) return;
  rmSync(project.projectPath, { recursive: true, force: true });
}
