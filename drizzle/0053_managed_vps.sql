-- Managed Windows VPS for NinjaTrader (docs/managed-vps-architecture.md).
--
-- vps_instances: one TradeLoop-managed Windows VPS per client, running
-- NinjaTrader 8 + the add-on + the read-only TradeLoop VPS agent. No broker
-- password is stored here — the client authenticates inside NinjaTrader on the
-- prepared VPS (or an authorized OAuth flow, when available).
--
-- vps_agent_commands: read-only commands the cloud queues for an agent to poll
-- and run (ping, health, sync_now, reconcile, reconnect, collect_logs). Each
-- expires and is bound to one instance. There is no order-entry command.
--
-- provider_device_keys gains vpsInstanceId so a managed VPS's agent key
-- (provider "vps_agent") links to its instance. Additive and backward
-- compatible: existing add-on device keys are untouched.
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "vpsInstanceId" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vps_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"connectionId" integer,
	"deviceKeyId" integer,
	"provider" text NOT NULL,
	"providerServerId" text,
	"hostname" text,
	"publicIp" text,
	"region" text,
	"operatingSystem" text,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"provisioningStep" text,
	"ninjaTraderStatus" text DEFAULT 'unknown' NOT NULL,
	"agentStatus" text DEFAULT 'unknown' NOT NULL,
	"brokerStatus" text DEFAULT 'unknown' NOT NULL,
	"addonVersion" text,
	"lastHeartbeatAt" timestamp,
	"lastSyncAt" timestamp,
	"lastError" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vps_instances_user" ON "vps_instances" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vps_instances_status" ON "vps_instances" USING btree ("provider","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vps_instances_due" ON "vps_instances" USING btree ("status","updatedAt");--> statement-breakpoint
ALTER TABLE "vps_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vps_agent_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"vpsInstanceId" integer NOT NULL,
	"userId" text NOT NULL,
	"command" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"issuedBy" text,
	"expiresAt" timestamp NOT NULL,
	"deliveredAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vps_agent_commands_poll" ON "vps_agent_commands" USING btree ("vpsInstanceId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vps_agent_commands_user" ON "vps_agent_commands" USING btree ("userId");--> statement-breakpoint
ALTER TABLE "vps_agent_commands" ENABLE ROW LEVEL SECURITY;
