//+------------------------------------------------------------------+
//| TradeloopSync.mq5                                                 |
//| Pushes newly closed trades and account balance to your Tradeloop  |
//| journal over HTTP. No third-party API, no broker credentials      |
//| leave this terminal.                                              |
//+------------------------------------------------------------------+
#property strict
#property description "Pushes closed trades and balance to a Tradeloop journal webhook."

input string WebhookUrl           = ""; // Full URL, e.g. http://192.168.1.23:3000/api/webhooks/metatrader
input string WebhookToken         = ""; // Token shown on the Settings page
input int    CheckIntervalSeconds = 30; // How often to check for newly closed trades

string LastCheckVarName()
{
   return "TradeloopSync_LastCheck_" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
}

string ToIso8601(datetime dt)
{
   MqlDateTime st;
   TimeToStruct(dt, st);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", st.year, st.mon, st.day, st.hour, st.min, st.sec);
}

int OnInit()
{
   if (WebhookUrl == "" || WebhookToken == "")
   {
      Print("TradeloopSync: set WebhookUrl and WebhookToken in the EA inputs first.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if (!GlobalVariableCheck(LastCheckVarName()))
   {
      // First run: look back 1 day so trades closed just before install aren't missed.
      GlobalVariableSet(LastCheckVarName(), (double)(TimeCurrent() - 86400));
   }
   EventSetTimer(CheckIntervalSeconds);
   Print("TradeloopSync: running, checking every ", CheckIntervalSeconds, "s");
   OnTimer(); // send an immediate balance check-in instead of waiting for the first interval
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void SendToWebhook(string payload)
{
   char data[];
   int len = StringToCharArray(payload, data, 0, StringLen(payload));
   ArrayResize(data, len); // drop the trailing null terminator

   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + WebhookToken + "\r\n";
   char result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", WebhookUrl, headers, 5000, data, result, resultHeaders);

   if (status == -1)
   {
      Print("TradeloopSync: WebRequest failed (error ", GetLastError(), "). Add ", WebhookUrl,
            " under Tools > Options > Expert Advisors > \"Allow WebRequest for listed URL\".");
   }
   else if (status != 200)
   {
      Print("TradeloopSync: webhook returned HTTP ", status, ": ", CharArrayToString(result));
   }
   else
   {
      Print("TradeloopSync: synced successfully — ", CharArrayToString(result));
   }
}

void OnTimer()
{
   datetime lastCheck = (datetime)GlobalVariableGet(LastCheckVarName());
   datetime now = TimeCurrent();
   if (!HistorySelect(lastCheck, now)) return;

   int total = HistoryDealsTotal();
   ulong positionIds[];
   int posCount = 0;
   datetime newestSeen = lastCheck;

   // Pass 1: find every position with a new closing deal in this window.
   for (int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if (ticket == 0) continue;
      long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if (dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;
      long entryType = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if (entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_OUT_BY) continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      if (dealTime > newestSeen) newestSeen = dealTime;

      ulong positionId = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      bool already = false;
      for (int k = 0; k < posCount; k++) if (positionIds[k] == positionId) { already = true; break; }
      if (already) continue;

      ArrayResize(positionIds, posCount + 1);
      positionIds[posCount] = positionId;
      posCount++;
   }

   // Pass 2: for each closed position, aggregate its deals into one round-trip trade.
   string tradesJson = "";
   int emitted = 0;

   for (int p = 0; p < posCount; p++)
   {
      if (!HistorySelectByPosition(positionIds[p])) continue;
      int posDeals = HistoryDealsTotal();

      double entryQty = 0, entryNotional = 0, exitQty = 0, exitNotional = 0;
      double totalCommission = 0, totalSwap = 0, totalProfit = 0;
      datetime entryTime = 0, exitTime = 0;
      long side = -1;
      string symbol = "";

      for (int j = 0; j < posDeals; j++)
      {
         ulong dt = HistoryDealGetTicket(j);
         if (dt == 0) continue;
         long dtType = HistoryDealGetInteger(dt, DEAL_TYPE);
         if (dtType != DEAL_TYPE_BUY && dtType != DEAL_TYPE_SELL) continue;

         long dtEntry = HistoryDealGetInteger(dt, DEAL_ENTRY);
         double vol = HistoryDealGetDouble(dt, DEAL_VOLUME);
         double price = HistoryDealGetDouble(dt, DEAL_PRICE);
         datetime dtTime = (datetime)HistoryDealGetInteger(dt, DEAL_TIME);
         totalCommission += HistoryDealGetDouble(dt, DEAL_COMMISSION);
         totalSwap += HistoryDealGetDouble(dt, DEAL_SWAP);
         totalProfit += HistoryDealGetDouble(dt, DEAL_PROFIT);
         symbol = HistoryDealGetString(dt, DEAL_SYMBOL);

         if (dtEntry == DEAL_ENTRY_IN)
         {
            entryQty += vol;
            entryNotional += vol * price;
            if (entryTime == 0 || dtTime < entryTime) entryTime = dtTime;
            side = dtType;
         }
         else if (dtEntry == DEAL_ENTRY_OUT || dtEntry == DEAL_ENTRY_OUT_BY)
         {
            exitQty += vol;
            exitNotional += vol * price;
            if (dtTime > exitTime) exitTime = dtTime;
         }
      }

      // Only report positions that are fully closed (partial closes wait for the final leg).
      if (entryQty <= 0 || exitQty <= 0 || MathAbs(entryQty - exitQty) > 0.0000001) continue;

      double entryPrice = entryNotional / entryQty;
      double exitPrice = exitNotional / exitQty;
      string sideStr = (side == DEAL_TYPE_BUY) ? "long" : "short";
      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

      if (emitted > 0) tradesJson += ",";
      tradesJson += "{";
      tradesJson += "\"positionId\":" + IntegerToString((long)positionIds[p]) + ",";
      tradesJson += "\"symbol\":\"" + symbol + "\",";
      tradesJson += "\"side\":\"" + sideStr + "\",";
      tradesJson += "\"quantity\":" + DoubleToString(entryQty, 2) + ",";
      tradesJson += "\"entryPrice\":" + DoubleToString(entryPrice, digits) + ",";
      tradesJson += "\"exitPrice\":" + DoubleToString(exitPrice, digits) + ",";
      tradesJson += "\"entryTime\":\"" + ToIso8601(entryTime) + "\",";
      tradesJson += "\"exitTime\":\"" + ToIso8601(exitTime) + "\",";
      tradesJson += "\"commission\":" + DoubleToString(totalCommission, 2) + ",";
      tradesJson += "\"swap\":" + DoubleToString(totalSwap, 2) + ",";
      tradesJson += "\"profit\":" + DoubleToString(totalProfit, 2);
      tradesJson += "}";
      emitted++;
   }

   GlobalVariableSet(LastCheckVarName(), (double)newestSeen);

   // Always check in with the current balance, even with zero new trades, so
   // the journal's account balance stays live without a separate API.
   string payload = "{";
   payload += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   payload += "\"currency\":\"" + AccountInfoString(ACCOUNT_CURRENCY) + "\",";
   payload += "\"trades\":[" + tradesJson + "]";
   payload += "}";

   SendToWebhook(payload);
}
