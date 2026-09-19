CREATE TABLE "import_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"source" text,
	"fileName" text,
	"fileSize" integer,
	"status" text NOT NULL,
	"totalRows" integer,
	"skippedRows" integer,
	"imported" integer,
	"duplicates" integer,
	"error" text,
	"accountId" integer,
	"fileContent" text,
	"retryOf" integer,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"broker" text NOT NULL,
	"connectionId" integer NOT NULL,
	"userId" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"imported" integer,
	"error" text,
	"durationMs" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_events_created_idx" ON "import_events" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "import_events_user_idx" ON "import_events" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sync_runs_created_idx" ON "sync_runs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("broker","connectionId");--> statement-breakpoint
-- Keep the new tables out of Supabase's public REST API (see 0000).
ALTER TABLE "import_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;
