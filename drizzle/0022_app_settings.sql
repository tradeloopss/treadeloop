-- A small global key/value store for admin-tunable settings. First use: the
-- Rithmic auto-sync interval (how long a connection is left before background
-- sync re-syncs it), set from the admin Broker health page. Written by admins
-- through server actions and read by the background sync loop.
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;
