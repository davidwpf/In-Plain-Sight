import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const games = sqliteTable('games', {
  code: text('code').primaryKey(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
});
