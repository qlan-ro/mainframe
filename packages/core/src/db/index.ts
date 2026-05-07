import Database from 'better-sqlite3';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import { initializeSchema } from './schema.js';
import { ProjectsRepository } from './projects.js';
import { ChatsRepository } from './chats.js';
import { SettingsRepository } from './settings.js';
import { DevicesRepository } from './devices.js';
import { TagsRepository } from './tags.js';
import { ChatTagsRepository } from './chat-tags.js';

export class DatabaseManager {
  private db: Database.Database;
  public projects: ProjectsRepository;
  public chats: ChatsRepository;
  public settings: SettingsRepository;
  public devices: DevicesRepository;
  public tags: TagsRepository;
  public chatTags: ChatTagsRepository;

  constructor() {
    const dbPath = join(getDataDir(), 'mainframe.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    initializeSchema(this.db);

    this.projects = new ProjectsRepository(this.db);
    this.tags = new TagsRepository(this.db);
    this.chatTags = new ChatTagsRepository(this.db);
    // Pass chatTags into ChatsRepository so list/get can populate Chat.tags
    this.chats = new ChatsRepository(this.db, this.chatTags);
    this.settings = new SettingsRepository(this.db);
    this.devices = new DevicesRepository(this.db);
  }

  close(): void {
    this.db.close();
  }
}

export { ProjectsRepository } from './projects.js';
export { ChatsRepository } from './chats.js';
export { SettingsRepository } from './settings.js';
export { DevicesRepository } from './devices.js';
export { TagsRepository } from './tags.js';
export { ChatTagsRepository } from './chat-tags.js';
