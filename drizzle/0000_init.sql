CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_pnl_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer,
	"date" text NOT NULL,
	"period" text DEFAULT 'daily' NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_pnl_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dashboard_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"statWidgets" jsonb NOT NULL,
	"panelWidgets" jsonb NOT NULL,
	"isActive" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"date" text NOT NULL,
	"autoSummary" text,
	"notes" text,
	"mood" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metatrader_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer,
	"metaApiAccountId" text NOT NULL,
	"tokenEnc" text NOT NULL,
	"tokenExpiresAt" timestamp,
	"login" text NOT NULL,
	"server" text NOT NULL,
	"platform" text NOT NULL,
	"lastSyncFrom" timestamp,
	"lastSyncedAt" timestamp,
	"lastSyncStatus" text,
	"lastSyncError" text,
	"lastSyncCount" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"period" text NOT NULL,
	"periodStart" text NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payout_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "playbook_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"playbookId" integer NOT NULL,
	"ownerId" text NOT NULL,
	"sharedWithUserId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shareToken" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "playbooks_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
CREATE TABLE "prop_firm_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" integer NOT NULL,
	"userId" text NOT NULL,
	"firmName" text,
	"planType" text,
	"phase" text DEFAULT 'evaluation' NOT NULL,
	"profitTargetPct" numeric(6, 2),
	"maxDrawdownPct" numeric(6, 2) NOT NULL,
	"drawdownType" text DEFAULT 'trailing' NOT NULL,
	"dailyLossLimitPct" numeric(6, 2),
	"minTradingDays" integer,
	"openingBalanceAdjustment" numeric(18, 2),
	"breachReasonTag" text,
	"autoDetected" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prop_firm_rules_accountId_unique" UNIQUE("accountId")
);
--> statement-breakpoint
CREATE TABLE "prop_firm_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" integer NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"category" text,
	"amount" numeric(18, 2) NOT NULL,
	"occurredAt" timestamp DEFAULT now() NOT NULL,
	"note" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rithmic_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer,
	"systemName" text NOT NULL,
	"gatewayUri" text NOT NULL,
	"fcmId" text NOT NULL,
	"ibId" text NOT NULL,
	"rithmicAccountId" text NOT NULL,
	"accountName" text NOT NULL,
	"login" text NOT NULL,
	"passwordEnc" text NOT NULL,
	"lastSyncFrom" timestamp,
	"lastSyncedAt" timestamp,
	"lastSyncStatus" text,
	"lastSyncError" text,
	"lastSyncCount" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text,
	"email" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"whopMembershipId" text,
	"whopPlanId" text,
	"currentPeriodEnd" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_whopMembershipId_unique" UNIQUE("whopMembershipId")
);
--> statement-breakpoint
CREATE TABLE "tag_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'violet' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"groupId" integer NOT NULL,
	"name" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer,
	"playbookId" integer,
	"symbol" text NOT NULL,
	"market" text DEFAULT 'futures' NOT NULL,
	"side" text DEFAULT 'long' NOT NULL,
	"status" text DEFAULT 'closed' NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"entryPrice" numeric(18, 6) DEFAULT '0' NOT NULL,
	"exitPrice" numeric(18, 6),
	"stopLoss" numeric(18, 6),
	"takeProfit" numeric(18, 6),
	"fees" numeric(18, 2) DEFAULT '0' NOT NULL,
	"pnl" numeric(18, 2) DEFAULT '0' NOT NULL,
	"rMultiple" numeric(10, 2),
	"contractMultiplier" numeric(18, 4) DEFAULT '1' NOT NULL,
	"expirationDate" timestamp,
	"entryTime" timestamp DEFAULT now() NOT NULL,
	"exitTime" timestamp,
	"rating" integer,
	"mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"externalId" text,
	"shareToken" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trades_shareToken_unique" UNIQUE("shareToken")
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"broker" text,
	"startingBalance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"currentBalance" numeric(18, 2),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_shares_unique" ON "playbook_shares" USING btree ("playbookId","sharedWithUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_account_external_unique" ON "trades" USING btree ("accountId","externalId");--> statement-breakpoint
-- Supabase exposes every table in "public" through its REST API to anyone
-- holding the public anon key. The app never uses that API (it connects to
-- Postgres directly as the table owner, which RLS does not restrict), so RLS
-- with no policies closes that door without affecting the app.
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_pnl_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payout_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playbook_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playbooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_firm_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rithmic_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tag_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tag_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trading_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
