-- Store live Rithmic open positions (from the P&L-plant snapshot, which the
-- sync already receives) on the connection, so the Trades Manager can show
-- running futures positions with their real floating P&L — and so a close
-- (exit-position) order has a symbol/exchange to act on. See lib/rithmic-sync
-- (refreshBrokerBalance) and lib/trade-manager (RithmicPosition).
ALTER TABLE "rithmic_connections" ADD COLUMN "openPositionsData" jsonb;
