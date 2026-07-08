import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';

export function initializeSchema(db: Database.Database): void {
  runMigrations(db);
}
