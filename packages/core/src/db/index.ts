import Database from 'better-sqlite3';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
import { initializeSchema } from './schema.js';
import { ProjectsRepository } from './projects.js';
import { ChatsRepository } from './chats.js';
import { SettingsRepository } from './settings.js';

export class DatabaseManager {
  private db: Database.Database;
  public projects: ProjectsRepository;
  public chats: ChatsRepository;
  public settings: SettingsRepository;

  constructor() {
    const dbPath = join(getDataDir(), 'mainframe.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    initializeSchema(this.db);

    this.projects = new ProjectsRepository(this.db);
    this.chats = new ChatsRepository(this.db);
    this.settings = new SettingsRepository(this.db);
  }

  close(): void {
    this.db.close();
  }
}

export { ProjectsRepository } from './projects.js';
export { ChatsRepository } from './chats.js';
export { SettingsRepository } from './settings.js';
