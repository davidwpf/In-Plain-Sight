CREATE TABLE `push_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_events` (
	`game_code` text NOT NULL,
	`round` integer NOT NULL,
	`created_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`game_code`) REFERENCES `games`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_events_game_round_idx` ON `push_events` (`game_code`,`round`);--> statement-breakpoint
CREATE INDEX `push_events_due_idx` ON `push_events` (`next_attempt_at`,`locked_until`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`endpoint_hash` text PRIMARY KEY NOT NULL,
	`game_code` text NOT NULL,
	`player_id` text NOT NULL,
	`subscription` text NOT NULL,
	`last_round` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`last_test_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`game_code`) REFERENCES `games`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_game_idx` ON `push_subscriptions` (`game_code`,`last_round`);--> statement-breakpoint
ALTER TABLE `games` ADD `next_event_at` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `notification_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `games_next_event_idx` ON `games` (`next_event_at`);
--> statement-breakpoint
UPDATE games SET next_event_at = CASE WHEN json_extract(state, '$.pausedAt') IS NULL THEN CASE json_extract(state, '$.phase') WHEN 'playing' THEN json_extract(state, '$.deadline') WHEN 'voting' THEN json_extract(state, '$.voteDeadline') END END, notification_round = CASE WHEN json_extract(state, '$.phase') IN ('voting', 'results', 'ended') THEN COALESCE(json_extract(state, '$.round'), 0) ELSE 0 END;
