CREATE TABLE "api_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"userId" text,
	"inputTokens" integer,
	"outputTokens" integer,
	"status" text NOT NULL,
	"error" text,
	"durationMs" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_timings" (
	"id" serial PRIMARY KEY NOT NULL,
	"route" text NOT NULL,
	"durationMs" integer NOT NULL,
	"status" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_usage_created_idx" ON "api_usage" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "request_timings_created_idx" ON "request_timings" USING btree ("createdAt");--> statement-breakpoint
-- Keep the new tables out of Supabase's public REST API (see 0000).
ALTER TABLE "api_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "request_timings" ENABLE ROW LEVEL SECURITY;
