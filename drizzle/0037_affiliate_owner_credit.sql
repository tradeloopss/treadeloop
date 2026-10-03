-- One partner account, at the owner's request (2026-10-03): a $1.00 credit,
-- available to withdraw at once. It is written the way an admin's "Add bonus"
-- writes it (lib/affiliates/commissions.addLedgerEntry): one ledger row with
-- status "available" (nothing to hold it for), a notification in the
-- affiliate's portal, and a line in the admin audit log. The idempotency key
-- means it can only ever be added once. Does nothing if that account isn't an
-- affiliate.
WITH credited AS (
	INSERT INTO "affiliate_commissions" ("affiliateId", "type", "amount", "currency", "status", "idempotencyKey", "approvedAt", "availableAt", "note", "createdBy")
	SELECT a."id", 'bonus', 1, 'usd', 'available', 'adj:owner-credit-2026-10-03', now(), now(), 'Credit added at the owner''s request', 'system'
	FROM "affiliates" a
	WHERE lower(a."email") = 'eslaamelsawi@gmail.com'
		OR a."userId" IN (SELECT u."id" FROM "user" u WHERE lower(u."email") = 'eslaamelsawi@gmail.com')
	ON CONFLICT ("idempotencyKey") DO NOTHING
	RETURNING "affiliateId"
), noted AS (
	INSERT INTO "affiliate_notifications" ("affiliateId", "type", "title", "body", "href")
	SELECT c."affiliateId", 'adjustment', 'Bonus added', 'A 1.00 USD credit was added to your balance. It is available to withdraw now.', '/affiliate/earnings'
	FROM credited c
	RETURNING "affiliateId"
)
INSERT INTO "admin_audit_log" ("actorId", "actorEmail", "action", "targetUserId", "details")
SELECT 'system', 'owner request (migration 0037)', 'affiliate.adjust', a."userId", jsonb_build_object('affiliateId', a."id", 'type', 'bonus', 'amount', 1, 'note', 'Credit added at the owner''s request')
FROM noted n JOIN "affiliates" a ON a."id" = n."affiliateId";--> statement-breakpoint
-- And nothing on the account stands in the way of withdrawing it: payout
-- requests on, with the $1 minimum this account already has (migration 0030).
-- (A payout method's own minimum still applies - that is a program rule.)
UPDATE "affiliates" SET "minPayoutOverride" = 1, "manualPayoutAllowed" = true, "updatedAt" = now()
WHERE lower("email") = 'eslaamelsawi@gmail.com'
	OR "userId" IN (SELECT u."id" FROM "user" u WHERE lower(u."email") = 'eslaamelsawi@gmail.com');
