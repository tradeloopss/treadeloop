-- Copy Trading runs in the background now, with nobody's browser to say what
-- time zone the trader is in. The group keeps it: the copy rules' trading hours
-- and days are read in it.
ALTER TABLE "copy_groups" ADD COLUMN IF NOT EXISTS "timeZone" text;
