ALTER TABLE "prop_firm_rules" ADD COLUMN "profitTargetAmount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ADD COLUMN "maxDrawdownAmount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ADD COLUMN "dailyLossLimitAmount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ADD COLUMN "consistencyPct" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ADD COLUMN "minPayoutDays" integer;--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ADD COLUMN "minDayProfit" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "prop_firm_rules" ADD COLUMN "payoutCap" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "balanceUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "brokerDrawdownFloor" numeric(18, 2);