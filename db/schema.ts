import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const games = sqliteTable('games', {
  code: text('code').primaryKey(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  inviteHash: text('invite_hash'),
  nextEventAt: integer('next_event_at'),
  notificationRound: integer('notification_round').notNull().default(0),
}, table => [index('games_expires_at_idx').on(table.expiresAt), uniqueIndex('games_invite_hash_idx').on(table.inviteHash), index('games_next_event_idx').on(table.nextEventAt)]);
export const pushConfig = sqliteTable('push_config', {
  id: integer('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
});
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpointHash: text('endpoint_hash').primaryKey(),
  gameCode: text('game_code').notNull().references(()=>games.code,{onDelete:'cascade'}),
  playerId: text('player_id').notNull(),
  subscription: text('subscription').notNull(),
  lastRound: integer('last_round').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
  lastTestAt: integer('last_test_at').notNull().default(0),
},table=>[index('push_subscriptions_game_idx').on(table.gameCode,table.lastRound)]);
export const pushEvents = sqliteTable('push_events', {
  gameCode: text('game_code').notNull().references(()=>games.code,{onDelete:'cascade'}),
  round: integer('round').notNull(),
  createdAt: integer('created_at').notNull(),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  lockedUntil: integer('locked_until').notNull().default(0),
},table=>[uniqueIndex('push_events_game_round_idx').on(table.gameCode,table.round),index('push_events_due_idx').on(table.nextAttemptAt,table.lockedUntil)]);
