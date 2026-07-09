// The replay matrix: every Phase-3 GET route (mounted route modules) with
// concrete seeded ids — happy, 404, and validation-failure cases — plus the
// mutation-parity probes (tags CRUD incl. the 204, settings PUT, files PUT +
// re-GET, the git commit flow, attachment upload + get). `path` may be a
// function of the accumulated per-daemon responses for steps whose input is a
// freshly-generated id.
export function buildMatrix(m) {
  const git = m.gitProjectId;
  const plain = m.plainProjectId;
  const chat = m.chatIds[0];
  const dbAffect = true;

  return [
    // ---- read-only GETs ---------------------------------------------------
    { id: 'health', method: 'GET', path: '/health', cat: 'read' },
    { id: 'auth-status', method: 'GET', path: '/api/auth/status', cat: 'read' },
    { id: 'auth-devices', method: 'GET', path: '/api/auth/devices', cat: 'read' },
    { id: 'commands', method: 'GET', path: '/api/commands', cat: 'read' },
    { id: 'tags-list', method: 'GET', path: '/api/tags', cat: 'read' },
    { id: 'settings-general', method: 'GET', path: '/api/settings/general', cat: 'read' },
    { id: 'settings-providers', method: 'GET', path: '/api/settings/providers', cat: 'read' },
    { id: 'config-conflicts', method: 'GET', path: '/api/adapters/claude/config-conflicts', cat: 'read' },
    { id: 'projects-list', method: 'GET', path: '/api/projects', cat: 'read' },
    { id: 'project-get-happy', method: 'GET', path: `/api/projects/${git}`, cat: 'read' },
    { id: 'project-get-404', method: 'GET', path: '/api/projects/does-not-exist', cat: 'read' },
    { id: 'chat-tags-happy', method: 'GET', path: `/api/chats/${chat}/tags`, cat: 'read' },
    // files-list returns raw directory-walk order (Node recursion vs Rust
    // stack), which is runtime/OS-dependent and unspecified — compare as a set.
    { id: 'files-list-happy', method: 'GET', path: `/api/projects/${git}/files-list`, cat: 'read', unordered: true },
    { id: 'files-list-404', method: 'GET', path: '/api/projects/bogus/files-list', cat: 'read' },
    { id: 'tree-happy', method: 'GET', path: `/api/projects/${git}/tree`, cat: 'read' },
    { id: 'search-files-happy', method: 'GET', path: `/api/projects/${git}/search/files`, query: { q: 'app' }, cat: 'read' },
    { id: 'search-content-happy', method: 'GET', path: `/api/projects/${git}/search/content`, query: { q: 'answer', path: m.gitRepo }, cat: 'read' },
    { id: 'search-content-400', method: 'GET', path: `/api/projects/${git}/search/content`, query: { q: 'a', path: m.gitRepo }, cat: 'read' },
    { id: 'file-content-happy', method: 'GET', path: `/api/projects/${git}/files`, query: { path: 'README.md' }, cat: 'read' },
    { id: 'file-content-404', method: 'GET', path: `/api/projects/${git}/files`, query: { path: 'nope.md' }, cat: 'read' },
    { id: 'paths-resolve-happy', method: 'GET', path: `/api/projects/${git}/paths/resolve`, query: { path: 'README.md' }, cat: 'read' },
    { id: 'paths-resolve-400', method: 'GET', path: `/api/projects/${git}/paths/resolve`, cat: 'read' },
    { id: 'files-external-happy', method: 'GET', path: '/api/files/external', query: { path: `${m.gitRepo}/README.md` }, cat: 'read' },
    { id: 'files-external-400', method: 'GET', path: '/api/files/external', cat: 'read' },
    { id: 'filesystem-browse-happy', method: 'GET', path: '/api/filesystem/browse', query: { path: m.gitRepo }, cat: 'read' },
    { id: 'git-branch', method: 'GET', path: `/api/projects/${git}/git/branch`, cat: 'read' },
    { id: 'git-branches', method: 'GET', path: `/api/projects/${git}/git/branches`, cat: 'read' },
    { id: 'git-branch-diffs', method: 'GET', path: `/api/projects/${git}/git/branch-diffs`, cat: 'read' },
    { id: 'git-status', method: 'GET', path: `/api/projects/${git}/git/status`, cat: 'read' },
    { id: 'git-status-404', method: 'GET', path: '/api/projects/bogus/git/status', cat: 'read' },
    { id: 'git-working-stat', method: 'GET', path: `/api/projects/${git}/git/working-stat`, cat: 'read' },
    { id: 'git-diff', method: 'GET', path: `/api/projects/${git}/git/diff`, cat: 'read' },
    { id: 'attach-get-seeded', method: 'GET', path: `/api/chats/${chat}/attachments/${m.attachmentId}`, cat: 'read' },
    { id: 'attach-get-404', method: 'GET', path: `/api/chats/${chat}/attachments/does-not-exist`, cat: 'read' },

    // ---- mutation parity probes -------------------------------------------
    { id: 'device-activity', method: 'POST', path: '/api/device/activity', body: { state: 'active' }, cat: 'mut' },

    { id: 'tag-create', method: 'POST', path: '/api/tags', body: { name: 'diffd-new', color: 'green' }, cat: 'mut', dbAffect },
    { id: 'tag-patch', method: 'PATCH', path: '/api/tags/diffd-new', body: { rename: 'diffd-renamed', color: 'purple' }, cat: 'mut', dbAffect },
    { id: 'tag-delete', method: 'DELETE', path: '/api/tags/diffd-renamed', cat: 'mut', dbAffect },
    { id: 'tag-delete-404', method: 'DELETE', path: '/api/tags/never-existed', cat: 'mut' },

    { id: 'settings-put-general', method: 'PUT', path: '/api/settings/general', body: { worktreeDir: 'wt-diffd' }, cat: 'mut', dbAffect },
    { id: 'settings-put-provider', method: 'PUT', path: '/api/settings/providers/claude', body: { defaultModel: 'claude-opus-4', defaultMode: 'acceptEdits' }, cat: 'mut', dbAffect },

    { id: 'file-put', method: 'PUT', path: `/api/projects/${git}/files`, body: { path: 'src/app.js', content: 'export const answer = 43;\n' }, cat: 'mut' },
    { id: 'file-put-reget', method: 'GET', path: `/api/projects/${git}/files`, query: { path: 'src/app.js' }, cat: 'mut' },

    { id: 'git-create-branch', method: 'POST', path: `/api/projects/${git}/git/branch`, body: { name: 'diffd-branch' }, cat: 'mut' },
    { id: 'git-checkout', method: 'POST', path: `/api/projects/${git}/git/checkout`, body: { branch: 'diffd-branch' }, cat: 'mut' },
    { id: 'git-commit', method: 'POST', path: `/api/projects/${git}/git/commit`, body: { message: 'diffd commit' }, cat: 'mut' },
    { id: 'git-status-after', method: 'GET', path: `/api/projects/${git}/git/status`, cat: 'mut' },

    // git-write branch lifecycle (deterministic on the seeded repo — we are on
    // diffd-branch, so the seed's `feature` branch can be renamed then deleted).
    { id: 'git-rename-branch', method: 'POST', path: `/api/projects/${git}/git/rename-branch`, body: { oldName: 'feature', newName: 'feature-renamed' }, cat: 'mut' },
    { id: 'git-delete-branch', method: 'POST', path: `/api/projects/${git}/git/delete-branch`, body: { name: 'feature-renamed' }, cat: 'mut' },

    // git-chat (chat-scoped) — chat[0] has no worktree, so its effective path is
    // the project repo. status/stage/unstage/commit/diff-since-main are the
    // previously-uncovered Phase-3 group.
    { id: 'git-chat-status', method: 'POST', path: '/api/git/status', body: { chatId: chat }, cat: 'mut' },
    { id: 'git-chat-stage', method: 'POST', path: '/api/git/stage', body: { chatId: chat, files: ['scratch.txt'] }, cat: 'mut' },
    { id: 'git-chat-unstage', method: 'POST', path: '/api/git/unstage', body: { chatId: chat, files: ['scratch.txt'] }, cat: 'mut' },
    { id: 'git-chat-diff-since-main', method: 'POST', path: `/api/projects/${git}/git/diff-since-main`, body: { chatId: chat }, cat: 'mut' },

    // PUT chat-tags — replace chat[0]'s seeded tag set (deterministic parity).
    { id: 'chat-tags-put', method: 'PUT', path: `/api/chats/${chat}/tags`, body: { tags: ['bug'] }, cat: 'mut', dbAffect },

    { id: 'attach-create', method: 'POST', path: `/api/chats/${chat}/attachments`, body: { attachments: [{ name: 'probe.txt', mediaType: 'text/plain', data: Buffer.from('probe body\n').toString('base64') }] }, cat: 'mut' },
    {
      id: 'attach-create-get',
      method: 'GET',
      cat: 'mut',
      path: (results) => {
        const id = results['attach-create']?.body?.data?.attachments?.[0]?.id;
        return id ? `/api/chats/${chat}/attachments/${id}` : `/api/chats/${chat}/attachments/__missing__`;
      },
    },

    // LAST: projects DELETE probe. It targets a dedicated, chat-less throwaway
    // project (registered here, per-daemon id) so the only post-run divergence is
    // the single projects row — deleting a seeded project would also cascade its
    // chats, muddying the comparison. Node removes the row (200); Rust returns the
    // Phase-4/5 ChatManager seam 500 and keeps it, making the seam explicit.
    { id: 'projects-create-throwaway', method: 'POST', path: '/api/projects', body: { path: `${m.plainProj}/diffd-throwaway` }, cat: 'mut', dbAffect },
    {
      id: 'projects-delete',
      method: 'DELETE',
      cat: 'mut',
      dbAffect,
      path: (results) => {
        const id = results['projects-create-throwaway']?.body?.data?.id;
        return id ? `/api/projects/${id}` : '/api/projects/__missing__';
      },
    },
  ];
}
