CREATE TABLE "starter_playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "starter_tag_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"userId" text PRIMARY KEY NOT NULL,
	"seededAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Keep the new tables out of Supabase's public REST API (see 0000).
ALTER TABLE "starter_tag_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "starter_playbooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_onboarding" ENABLE ROW LEVEL SECURITY;
