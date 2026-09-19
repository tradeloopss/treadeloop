CREATE TABLE "tradingview_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer NOT NULL,
	"name" text NOT NULL,
	"market" text DEFAULT 'stocks' NOT NULL,
	"webhookToken" text NOT NULL,
	"lastEventAt" timestamp,
	"lastStatus" text,
	"lastError" text,
	"eventCount" integer DEFAULT 0 NOT NULL,
	"tradeCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tradingview_connections_webhookToken_unique" UNIQUE("webhookToken")
);
--> statement-breakpoint
CREATE TABLE "tradingview_fills" (
	"id" serial PRIMARY KEY NOT NULL,
	"connectionId" integer NOT NULL,
	"eventId" text NOT NULL,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"filledAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tradingview_fills_event_unique" ON "tradingview_fills" USING btree ("connectionId","eventId");
