import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../db/schema.js';
import { SettingsRepository } from '../../db/settings.js';

describe('SettingsRepository', () => {
  let db: Database.Database;
  let settings: SettingsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeSchema(db);
    settings = new SettingsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('get', () => {
    it('returns null for a missing key', () => {
      const result = settings.get('general', 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns the value for an existing key', () => {
      settings.set('general', 'theme', 'dark');

      const result = settings.get('general', 'theme');
      expect(result).toBe('dark');
    });

    it('distinguishes between different categories with the same key', () => {
      settings.set('general', 'name', 'General Name');
      settings.set('adapters', 'name', 'Adapters Name');

      expect(settings.get('general', 'name')).toBe('General Name');
      expect(settings.get('adapters', 'name')).toBe('Adapters Name');
    });
  });

  describe('set', () => {
    it('inserts a new setting', () => {
      settings.set('general', 'theme', 'dark');

      expect(settings.get('general', 'theme')).toBe('dark');
    });

    it('upserts — setting the same key twice overwrites the value', () => {
      settings.set('general', 'theme', 'dark');
      settings.set('general', 'theme', 'light');

      expect(settings.get('general', 'theme')).toBe('light');
    });

    it('upsert does not create duplicate rows', () => {
      settings.set('general', 'theme', 'dark');
      settings.set('general', 'theme', 'light');

      const count = db
        .prepare("SELECT COUNT(*) as cnt FROM settings WHERE category = 'general' AND key = 'theme'")
        .get() as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('can store JSON values as strings', () => {
      const json = JSON.stringify({ fontSize: 14, fontFamily: 'monospace' });
      settings.set('editor', 'config', json);

      const result = settings.get('editor', 'config');
      expect(JSON.parse(result!)).toEqual({ fontSize: 14, fontFamily: 'monospace' });
    });
  });

  describe('getByCategory', () => {
    it('returns all settings for a category as a key-value record', () => {
      settings.set('general', 'theme', 'dark');
      settings.set('general', 'language', 'en');
      settings.set('general', 'fontSize', '14');

      const result = settings.getByCategory('general');
      expect(result).toEqual({
        theme: 'dark',
        language: 'en',
        fontSize: '14',
      });
    });

    it('returns empty object for a category with no settings', () => {
      const result = settings.getByCategory('nonexistent');
      expect(result).toEqual({});
    });

    it('does not include settings from other categories', () => {
      settings.set('general', 'theme', 'dark');
      settings.set('adapters', 'default', 'claude');

      const result = settings.getByCategory('general');
      expect(result).toEqual({ theme: 'dark' });
      expect(result).not.toHaveProperty('default');
    });
  });

  describe('delete', () => {
    it('removes a setting', () => {
      settings.set('general', 'theme', 'dark');
      expect(settings.get('general', 'theme')).toBe('dark');

      settings.delete('general', 'theme');
      expect(settings.get('general', 'theme')).toBeNull();
    });

    it('does not error when deleting a nonexistent key', () => {
      expect(() => settings.delete('general', 'nonexistent')).not.toThrow();
    });

    it('only deletes the targeted setting', () => {
      settings.set('general', 'theme', 'dark');
      settings.set('general', 'language', 'en');

      settings.delete('general', 'theme');

      expect(settings.get('general', 'theme')).toBeNull();
      expect(settings.get('general', 'language')).toBe('en');
    });
  });
});
