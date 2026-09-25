//+------------------------------------------------------------------+
//| TradeLoopExport — run by the TradeLoop MT4 bridge                 |
//| (worker/mt5/bridge_mt4.py) through the terminal's startup config. |
//| Waits for the login, writes the account's info, closed history    |
//| and open orders to MQL4\Files\tradeloop-<login>.json, then closes |
//| the terminal. Read-only: it never touches an order.               |
//+------------------------------------------------------------------+
#property strict

string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   return s;
  }

string Num(double v)
  {
   return DoubleToString(v, 8);
  }

// The selected order (OrderSelect) as JSON.
string OrderJson()
  {
   return StringFormat("{\"ticket\":%d,\"type\":%d,\"lots\":%s,\"symbol\":\"%s\",\"openTime\":%d,\"openPrice\":%s,"
                       "\"closeTime\":%d,\"closePrice\":%s,\"sl\":%s,\"tp\":%s,\"commission\":%s,\"swap\":%s,\"profit\":%s,"
                       "\"magic\":%d,\"comment\":\"%s\"}",
                       OrderTicket(), OrderType(), Num(OrderLots()), Esc(OrderSymbol()), (int)OrderOpenTime(), Num(OrderOpenPrice()),
                       (int)OrderCloseTime(), Num(OrderClosePrice()), Num(OrderStopLoss()), Num(OrderTakeProfit()),
                       Num(OrderCommission()), Num(OrderSwap()), Num(OrderProfit()), OrderMagicNumber(), Esc(OrderComment()));
  }

void OnStart()
  {
// Wait for the login to complete, then for the history download to settle.
   for(int i = 0; i < 240 && (!IsConnected() || AccountNumber() == 0); i++)
      Sleep(250);
   if(AccountNumber() == 0)
     {
      TerminalClose(1);
      return;
     }
   int last = -1;
   for(int j = 0; j < 30; j++)
     {
      int n = OrdersHistoryTotal();
      if(n == last && j >= 4)
         break;
      last = n;
      Sleep(500);
     }

   string name = "tradeloop-" + IntegerToString(AccountNumber()) + ".json";
   string part = name + ".part";
   int h = FileOpen(part, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
     {
      TerminalClose(2);
      return;
     }
   FileWriteString(h, StringFormat("{\"account\":{\"login\":%d,\"name\":\"%s\",\"company\":\"%s\",\"server\":\"%s\",\"currency\":\"%s\","
                                   "\"balance\":%s,\"equity\":%s,\"leverage\":%d},\"serverClock\":%d,\"history\":[",
                                   AccountNumber(), Esc(AccountName()), Esc(AccountCompany()), Esc(AccountServer()), AccountCurrency(),
                                   Num(AccountBalance()), Num(AccountEquity()), AccountLeverage(), (int)TimeCurrent()));
   bool first = true;
   int total = OrdersHistoryTotal();
   for(int k = 0; k < total; k++)
      if(OrderSelect(k, SELECT_BY_POS, MODE_HISTORY))
        {
         FileWriteString(h, (first ? "" : ",") + OrderJson());
         first = false;
        }
   FileWriteString(h, "],\"open\":[");
   first = true;
   for(int m = 0; m < OrdersTotal(); m++)
      if(OrderSelect(m, SELECT_BY_POS, MODE_TRADES))
        {
         FileWriteString(h, (first ? "" : ",") + OrderJson());
         first = false;
        }
   FileWriteString(h, "]}");
   FileClose(h);
// Rename last, so the bridge never reads a half-written file.
   FileMove(part, 0, name, FILE_REWRITE);
   TerminalClose(0);
  }
//+------------------------------------------------------------------+
