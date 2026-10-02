-- A payout's own ledger row (the reservation) is managed only by the payout's
-- status changes. Releasing commission holds used to sweep up a payout that was
-- still awaiting approval and mark its row "available", which made the
-- reserved amount show as available again until the payout was approved. The
-- code no longer does that; this puts any row it touched back.
UPDATE "affiliate_commissions" c
SET "status" = 'pending', "approvedAt" = NULL, "availableAt" = NULL
FROM "affiliate_payouts" p
WHERE c."payoutId" = p."id" AND c."type" = 'payout' AND p."status" = 'pending' AND c."status" IN ('approved', 'available');--> statement-breakpoint

-- The holding period was shortened in the program rules: commissions still
-- waiting follow the period as it is set now (read from the saved settings),
-- instead of the date they were given when they were created. Only ever
-- brings a date forward. The payout worker releases them on its next pass.
UPDATE "affiliate_commissions" c
SET "holdUntil" = c."createdAt" + make_interval(days => s."days")
FROM (
	SELECT LEAST(180, GREATEST(0, round(("value"->>'holdDays')::numeric)))::int AS "days"
	FROM "app_settings"
	WHERE "key" = 'affiliate_program' AND ("value"->>'holdDays') ~ '^[0-9]+(\.[0-9]+)?$'
) s
WHERE c."status" = 'pending' AND c."type" <> 'payout' AND c."reversesId" IS NULL AND c."holdUntil" IS NOT NULL AND c."holdUntil" > c."createdAt" + make_interval(days => s."days");--> statement-breakpoint

-- A partial refund keeps the date of the commission it nets against.
UPDATE "affiliate_commissions" r
SET "holdUntil" = o."holdUntil"
FROM "affiliate_commissions" o
WHERE r."reversesId" = o."id" AND r."status" = 'pending' AND r."type" <> 'payout' AND o."holdUntil" IS NOT NULL AND r."holdUntil" IS DISTINCT FROM o."holdUntil";
