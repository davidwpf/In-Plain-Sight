ALTER TABLE `games` ADD `invite_hash` text;--> statement-breakpoint
CREATE INDEX `games_expires_at_idx` ON `games` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_invite_hash_idx` ON `games` (`invite_hash`);