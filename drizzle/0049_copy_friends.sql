-- The Friends page of Copy Trading (lib/copy/friends.ts).
--
-- shareResults: whether a friend lets the owner of a strategy see what their
-- copies of it came to (profit and loss, open positions). Off for everyone who
-- joined before it existed: they were never asked. A friend's membership can
-- now also be "paused" by the owner (status), which stops their copying and
-- keeps their place.
ALTER TABLE "copy_share_members" ADD COLUMN IF NOT EXISTS "shareResults" boolean DEFAULT false NOT NULL;
