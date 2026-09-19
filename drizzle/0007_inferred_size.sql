ALTER TABLE "trading_accounts" ADD COLUMN "startingBalanceInferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Accounts a Rithmic connect created started at $0 and had their size guessed
-- from the balance later. Where the user never saved the rules form
-- themselves (no rules, or rules still auto-detected) that guess is all
-- there is, so flag it for the improved inference to redo on the next sync.
UPDATE "trading_accounts" a SET "startingBalanceInferred" = true
WHERE EXISTS (SELECT 1 FROM "rithmic_connections" c WHERE c."accountId" = a.id)
  AND NOT EXISTS (SELECT 1 FROM "prop_firm_rules" r WHERE r."accountId" = a.id AND r."autoDetected" = false);
