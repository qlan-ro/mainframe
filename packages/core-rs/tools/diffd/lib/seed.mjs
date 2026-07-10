// Constructs the seed: a real git repo + a plain project dir, then boots the
// NODE daemon once and drives its HTTP API to create 2 projects, tags, 3 chats
// (with a tag assignment + settings), and an attachment. The resulting data dir
// is byte-copied for each replay daemon. Ids are captured into a manifest.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Daemon } from './daemon.mjs';
import { freePort, req } from './util.mjs';

const GIT_ENV = ['-c', 'user.email=diffd@example.com', '-c', 'user.name=diffd'];
const git = (cwd, args) => execFileSync('git', [...GIT_ENV, ...args], { cwd, stdio: 'pipe' });

function buildGitRepo(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n\ninitial content\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'initial commit']);
  git(dir, ['branch', 'feature']);
  // Leave a dirty working tree: one modified tracked file + one untracked file.
  fs.appendFileSync(path.join(dir, 'README.md'), 'a dirty edit\n');
  fs.writeFileSync(path.join(dir, 'scratch.txt'), 'untracked\n');
}

function buildPlainProject(dir) {
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'plain project notes\n');
  fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), '# guide\n');
  // A trivial, deterministic launch config for the launch configs/status/start/
  // stop probes. `node` is the only allowlisted executable guaranteed present
  // (the daemons run on Node); the setInterval keeps the child alive until the
  // matrix stops it. `port: null` avoids a real TCP bind — no cross-phase port
  // race and no 60s port-readiness wait — so `start` reaches `running` on spawn.
  fs.mkdirSync(path.join(dir, '.mainframe'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.mainframe', 'launch.json'),
    JSON.stringify(
      {
        version: '1.0',
        configurations: [
          {
            name: 'diffd-probe',
            runtimeExecutable: 'node',
            runtimeArgs: ['-e', 'setInterval(() => {}, 1000000)'],
            port: null,
          },
        ],
      },
      null,
      2,
    ),
  );
}

async function projectIdByPath(base, wantPath) {
  const res = await req(base, 'GET', '/api/projects');
  const list = res.body?.data ?? res.body ?? [];
  const hit = list.find((p) => p.path === wantPath);
  return hit?.id;
}

export async function buildSeed(workRoot, nodeCmd) {
  const gitRepo = path.join(workRoot, 'proj', 'git');
  const plainProj = path.join(workRoot, 'proj', 'plain');
  buildGitRepo(gitRepo);
  buildPlainProject(plainProj);

  const seedDir = path.join(workRoot, 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  const port = await freePort();
  const daemon = new Daemon({
    kind: 'node-seed',
    cmd: nodeCmd.cmd,
    args: nodeCmd.args,
    dataDir: seedDir,
    port,
    logPath: path.join(workRoot, 'seed-daemon.log'),
    cwd: nodeCmd.cwd,
  });
  await daemon.start();
  const base = daemon.baseUrl;

  await req(base, 'POST', '/api/projects', { body: { path: gitRepo, name: 'git-proj' } });
  await req(base, 'POST', '/api/projects', { body: { path: plainProj, name: 'plain-proj' } });
  const gitProjectId = await projectIdByPath(base, gitRepo);
  const plainProjectId = await projectIdByPath(base, plainProj);

  await req(base, 'POST', '/api/tags', { body: { name: 'feature', color: 'blue' } });
  await req(base, 'POST', '/api/tags', { body: { name: 'bug', color: 'red' } });

  const chatIds = [];
  for (const projectId of [gitProjectId, gitProjectId, plainProjectId]) {
    const res = await req(base, 'POST', '/api/chats', { body: { projectId, adapterId: 'claude' } });
    const id = res.body?.data?.id ?? res.body?.data?.chat?.id ?? res.body?.id;
    if (id) chatIds.push(id);
  }
  if (chatIds.length) {
    await req(base, 'PUT', `/api/chats/${chatIds[0]}/tags`, { body: { tags: ['feature'] } });
  }

  await req(base, 'PUT', '/api/settings/general', {
    body: { worktreeDir: '.worktrees', notifications: { chat: { taskComplete: true, sessionError: false } } },
  });
  await req(base, 'PUT', '/api/settings/providers/claude', {
    body: { defaultModel: 'claude-sonnet-4', defaultMode: 'default' },
  });

  let attachmentId;
  if (chatIds.length) {
    const data = Buffer.from('attachment payload for diffd\n').toString('base64');
    const res = await req(base, 'POST', `/api/chats/${chatIds[0]}/attachments`, {
      body: { attachments: [{ name: 'note.txt', mediaType: 'text/plain', data }] },
    });
    attachmentId = res.body?.data?.attachments?.[0]?.id;
  }

  await daemon.stop();

  const manifest = { gitProjectId, plainProjectId, chatIds, attachmentId, gitRepo, plainProj };
  fs.writeFileSync(path.join(workRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { seedDir, manifest, projDir: path.join(workRoot, 'proj') };
}
