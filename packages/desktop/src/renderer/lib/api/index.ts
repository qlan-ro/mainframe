export { API_BASE, fetchJson, postJson, putJson, deleteRequest } from './http';

export {
  getProjects,
  createProject,
  removeProject,
  getChats,
  getAllChats,
  archiveChat,
  getChatMessages,
  getAdapters,
} from './projects-api';

export {
  getFileTree,
  getFilesList,
  searchFiles,
  getFileContent,
  getFileBinary,
  getPendingPermission,
  getSessionDiffs,
  getSessionContext,
  getSessionFile,
  addMention,
  browseFilesystem,
  saveFileContent,
  searchContent,
} from './files-api';

export type { SessionFileDiff } from './files-api';

export {
  getGitBranch,
  getGitStatus,
  getGitBranches,
  gitCheckout,
  gitCreateBranch,
  gitFetch,
  gitPull,
  gitPush,
  gitMerge,
  gitRebase,
  gitAbort,
  gitRenameBranch,
  gitDeleteBranch,
  gitUpdateAll,
  getDiff,
  getBranchDiffs,
} from './git-api';

export type { BranchDiffResponse } from './git-api';

export {
  getSkills,
  getAgents,
  createSkill,
  updateSkill,
  deleteSkill,
  createAgent,
  updateAgent,
  deleteAgent,
} from './skills-api';

export {
  getProviderSettings,
  updateProviderSettings,
  getGeneralSettings,
  updateGeneralSettings,
  getConfigConflicts,
} from './settings-api';

export { getAttachment, uploadAttachments } from './attachments-api';

export { getPlugins } from './plugins-api';

export { getCommands } from './commands-api';

export { getExternalSessions, importExternalSession } from './external-sessions-api';

export {
  getTunnelStatus,
  startTunnel,
  stopTunnel,
  getTunnelConfig,
  generatePairingCode,
  getDevices,
  removeDevice,
} from './remote-access-api';

export {
  enableWorktree,
  disableWorktree,
  forkToWorktree,
  getWorktrees as getProjectWorktrees,
  attachWorktree,
} from './worktree-api';
