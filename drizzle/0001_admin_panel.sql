CREATE TABLE "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorId" text NOT NULL,
	"actorEmail" text NOT NULL,
	"action" text NOT NULL,
	"targetUserId" text,
	"details" jsonb,
	"ipAddress" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"endsAt" timestamp,
	"createdBy" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "source" text DEFAULT 'whop' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banReason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banExpires" timestamp;--> statement-breakpoint
-- Same as 0000: keep the new tables out of Supabase's public REST API. The
-- app connects as the table owner, which RLS does not restrict.
ALTER TABLE "admin_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
