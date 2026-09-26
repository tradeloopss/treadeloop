-- Store the live MT5 open positions (not just their count) on the connection,
-- so the Trade Manager and PropFirm Max can show running trades with their real
-- floating P&L, current price and SL/TP. The MT5 worker already fetches these
-- (positions_get) — it just discarded everything but the count. See
-- worker/mt5/worker.ts and lib/trade-manager.ts (Mt5Position).
ALTER TABLE "metatrader_connections" ADD COLUMN "openPositionsData" jsonb;
