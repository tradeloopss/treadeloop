-- An admin can lift the wallet-change security hold on a payout method. The
-- moment is recorded: a method whose hold was lifted by a person is also
-- treated as "on file long enough" for automatic sending.
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "holdWaivedAt" timestamp;--> statement-breakpoint

-- One partner account's payout methods, at the owner's request (2026-10-02):
-- the hold is lifted, with a line in the payout audit trail saying so. Does
-- nothing if that account has no payout method — the same action is on the
-- affiliate's admin page.
INSERT INTO "affiliate_payout_events" ("affiliateId", "methodId", "actorType", "action", "previous", "next", "reason")
SELECT m."affiliateId", m."id", 'system', 'method.hold_removed', jsonb_build_object('holdUntil', m."holdUntil"), jsonb_build_object('holdUntil', NULL), 'Owner request: security hold lifted'
FROM "affiliate_payout_methods" m
JOIN "affiliates" a ON a."id" = m."affiliateId"
WHERE lower(a."email") = 'eslaamelsawi@gmail.com' AND m."status" <> 'removed' AND m."holdWaivedAt" IS NULL;--> statement-breakpoint
UPDATE "affiliate_payout_methods" m
SET "holdUntil" = NULL, "holdWaivedAt" = now(), "updatedAt" = now()
FROM "affiliates" a
WHERE a."id" = m."affiliateId" AND lower(a."email") = 'eslaamelsawi@gmail.com' AND m."status" <> 'removed' AND m."holdWaivedAt" IS NULL;
