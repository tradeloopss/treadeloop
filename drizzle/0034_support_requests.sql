-- Support requests from the Contact Support window, which works without an
-- account: the ticket carries the sender's email instead of a user id.
ALTER TABLE "support_tickets" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "page" text;--> statement-breakpoint
-- HMAC of the sender's IP, for rate limiting only (never the address itself).
ALTER TABLE "support_tickets" ADD COLUMN "ipHash" text;--> statement-breakpoint
CREATE INDEX "support_tickets_email_idx" ON "support_tickets" USING btree ("email","createdAt");--> statement-breakpoint
CREATE INDEX "support_tickets_ip_idx" ON "support_tickets" USING btree ("ipHash","createdAt");--> statement-breakpoint

-- Where a reply to an email should go when that is not its sender: a request
-- forwarded to the support inbox is answered to the customer.
ALTER TABLE "email_events" ADD COLUMN "replyTo" text;
