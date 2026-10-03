-- The same partner account as 0037, at the owner's request (2026-10-03): a
-- further $10.00 credit, available to withdraw at once - enough to clear the
-- minimum of the crypto payout methods. Written like an admin's "Add bonus":
-- one ledger row with status "available", a notification in the affiliate's
-- portal, and a line in the admin audit log. Its own idempotency key, so it is
-- added once and only once. Does nothing if that account isn't an affiliate.
WITH credited AS (
	INSERT INTO "affiliate_commissions" ("affiliateId", "type", "amount", "currency", "status", "idempotencyKey", "approvedAt", "availableAt", "note", "createdBy")
	SELECT a."id", 'bonus', 10, 'usd', 'available', 'adj:owner-credit-2026-10-03-b', now(), now(), 'Credit added at the owner''s request', 'system'
	FROM "affiliates" a
	WHERE lower(a."email") = 'eslaamelsawi@gmail.com'
		OR a."userId" IN (SELECT u."id" FROM "user" u WHERE lower(u."email") = 'eslaamelsawi@gmail.com')
	ON CONFLICT ("idempotencyKey") DO NOTHING
	RETURNING "affiliateId"
), noted AS (
	INSERT INTO "affiliate_notifications" ("affiliateId", "type", "title", "body", "href")
	SELECT c."affiliateId", 'adjustment', 'Bonus added', 'A 10.00 USD credit was added to your balance. It is available to withdraw now.', '/affiliate/earnings'
	FROM credited c
	RETURNING "affiliateId"
)
INSERT INTO "admin_audit_log" ("actorId", "actorEmail", "action", "targetUserId", "details")
SELECT 'system', 'owner request (migration 0038)', 'affiliate.adjust', a."userId", jsonb_build_object('affiliateId', a."id", 'type', 'bonus', 'amount', 10, 'note', 'Credit added at the owner''s request')
FROM noted n JOIN "affiliates" a ON a."id" = n."affiliateId";
