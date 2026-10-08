-- PNL Cards come in two looks (lib/pnl-cards/model.ts): the card made from Copy
-- Trading, and the dashboard's P&L certificate in its own gold design. Same
-- layouts, same switches, same link; which look a card has is kept with it.
ALTER TABLE "pnl_cards" ADD COLUMN IF NOT EXISTS "design" text DEFAULT 'card' NOT NULL;
