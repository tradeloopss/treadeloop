-- Pause background auto-sync per Rithmic connection. Prop firms flag an account
-- for too many sign-in attempts, and once a login is dead every background sync
-- is just another failed sign-in — so after repeated login failures the loop
-- pauses the connection instead of feeding the alarm. A manual "Sync now" still
-- runs and clears the pause on success. syncPausedReason is shown in the UI.
ALTER TABLE "rithmic_connections" ADD COLUMN "syncPaused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rithmic_connections" ADD COLUMN "syncPausedReason" text;
