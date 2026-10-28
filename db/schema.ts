import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const games = sqliteTable('games', {
  code: text('code').primaryKey(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  inviteHash: text('invite_hash'),
}, table => [index('games_expires_at_idx').on(table.expiresAt), uniqueIndex('games_invite_hash_idx').on(table.inviteHash)]);
