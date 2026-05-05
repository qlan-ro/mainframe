import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../schema.js';
import { ChatsRepository } from '../chats.js';
import { ProjectsRepository } from '../projects.js';
import { TagsRepository } from '../tags.js';
import { ChatTagsRepository } from '../chat-tags.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  const projects = new ProjectsRepository(db);
  const tags = new TagsRepository(db);
  const chatTags = new ChatTagsRepository(db);
  const chats = new ChatsRepository(db, chatTags);
  return { db, projects, tags, chatTags, chats };
}

describe('ChatsRepository — Chat.tags population', () => {
  it('list() populates Chat.tags from chat_tags', () => {
    const { projects, tags, chatTags, chats } = setup();
    const p = projects.create('/tmp/p');
    const chat = chats.create(p.id, 'claude');
    chatTags.setForChat(chat.id, ['feature', 'ui'], tags);
    const result = chats.list(p.id);
    expect(result).toHaveLength(1);
    expect(result[0]!.tags?.sort()).toEqual(['feature', 'ui']);
  });

  it('list() returns empty tags array for chats with no tags', () => {
    const { projects, chats } = setup();
    const p = projects.create('/tmp/p');
    chats.create(p.id, 'claude');
    const result = chats.list(p.id);
    expect(result[0]!.tags).toEqual([]);
  });

  it('list() does not run extra queries when chatTags is omitted (back-compat)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    const projects = new ProjectsRepository(db);
    const chatsNoTags = new ChatsRepository(db);
    const p = projects.create('/tmp/p');
    chatsNoTags.create(p.id, 'claude');
    const result = chatsNoTags.list(p.id);
    expect(result).toHaveLength(1);
    expect(result[0]!.tags).toBeUndefined();
  });

  it('get() populates Chat.tags for a single chat', () => {
    const { projects, tags, chatTags, chats } = setup();
    const p = projects.create('/tmp/p');
    const chat = chats.create(p.id, 'claude');
    chatTags.setForChat(chat.id, ['backend'], tags);
    const result = chats.get(chat.id);
    expect(result).not.toBeNull();
    expect(result!.tags).toEqual(['backend']);
  });

  it('get() returns empty tags array for a chat with no tags', () => {
    const { projects, chats } = setup();
    const p = projects.create('/tmp/p');
    const chat = chats.create(p.id, 'claude');
    const result = chats.get(chat.id);
    expect(result!.tags).toEqual([]);
  });
});
