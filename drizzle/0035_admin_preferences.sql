-- An admin's own choices for the admin area (dashboard version, sidebar,
-- which notifications to show, what has been read). A column of its own, so
-- saving the general Settings page can never overwrite them.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "admin" jsonb;
