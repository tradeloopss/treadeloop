// The TradeLoop add-on for NinjaTrader 8 (C#, NinjaScript). Served by
// POST /api/ninjatrader/addon with the trader's own sync key filled in; the
// trader drops it into Documents\NinjaTrader 8\bin\Custom\AddOns.
//
// It uses only NinjaScript's documented add-on API — Account.All,
// Account.AccountStatusUpdate, Account.ExecutionUpdate/OrderUpdate/PositionUpdate,
// Account.Executions/Orders/Positions, Account.Get, Execution, Order, Position,
// Instrument, MasterInstrument — to read the trader's own executions, orders and
// positions inside their own NinjaTrader, and posts them to TradeLoop over HTTPS.
// It never places, changes or cancels orders, and holds no broker password. Written for C# 5 (no string interpolation, no ?.)
// so it compiles in any NinjaTrader 8 release; anything not in the documented
// API (the time zone setting, the connection's provider name) is read by
// reflection with a safe fallback, so a NinjaTrader update can't break the
// compile. Checked by compiling against stand-ins of those types
// (tests/ninjatrader/, csc).
//
// The build for TradeLoop's own server (`provision` given) carries a second
// add-on in the same file, TradeLoop Provision. That one is never in a file a
// trader downloads. It asks the NinjaTrader worker (worker/ninjatrader, over
// 127.0.0.1) which Tradovate logins traders have entered in TradeLoop, keeps
// one NinjaTrader connection per login, named "tl-<id>", and tells the worker
// which were accepted and which Tradovate refused. A login is held in memory
// for the connection it makes: it is not written to a file, to NinjaTrader's
// saved connections or to the Output window. Like the rest, it only reads: it
// connects and disconnects, and never touches an order.

export const ADDON_VERSION = "1.1.0"
export const ADDON_FILENAME = "TradeLoopSync.cs"

// `provision`: only for the copy that runs in NinjaTrader on TradeLoop's own server. Where the worker's
// local API is (always this machine: 127.0.0.1) and the token it asks for.
export function addonSource(opts: { key: string; syncUrl: string; provision?: { url: string; token: string } }): string {
  if (!/^tlnt_[A-Za-z0-9_-]{20,}$/.test(opts.key)) throw new Error("invalid add-on key")
  if (!/^https?:\/\/[A-Za-z0-9.:/_-]+$/.test(opts.syncUrl)) throw new Error("invalid sync URL")
  if (opts.provision) {
    if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(opts.provision.url)) throw new Error("the provision API is only ever on 127.0.0.1")
    if (!/^[A-Za-z0-9_-]{20,}$/.test(opts.provision.token)) throw new Error("invalid provision token")
  }
  const provision = opts.provision ? PROVISION_TEMPLATE.split("__TRADELOOP_PROVISION_URL__").join(opts.provision.url).split("__TRADELOOP_PROVISION_TOKEN__").join(opts.provision.token) : ""
  return (TEMPLATE + provision)
    .split("__TRADELOOP_SYNC_KEY__")
    .join(opts.key)
    .split("__TRADELOOP_SYNC_URL__")
    .join(opts.syncUrl)
    .split("__TRADELOOP_ADDON_VERSION__")
    .join(ADDON_VERSION)
    .replace(/\r?\n/g, "\r\n")
}

const TEMPLATE = String.raw`// TradeLoop Sync — NinjaTrader 8 add-on, version __TRADELOOP_ADDON_VERSION__
//
// Sends the executions (fills), orders and positions of the accounts connected
// in this NinjaTrader to your TradeLoop journal, where the fills become trades
// with P&L. Works with prop-firm Tradovate accounts (Apex, Tradeify,
// MyFundedFutures…) connected through NinjaTrader's "NinjaTrader" connection,
// and with other brokers.
//
//   • Read-only: it never places, changes or cancels an order.
//   • It holds no broker password — only your TradeLoop sync key, below.
//     Keep this file private; you can remove the key any time in TradeLoop
//     (Accounts → the account → Disconnect), and download a new file.
//   • NinjaTrader's own simulation accounts (Sim101, playback) are skipped.
//
// Install: put this file in  Documents\NinjaTrader 8\bin\Custom\AddOns\
// then in NinjaTrader: New → NinjaScript Editor → press F5 to compile
// (or restart NinjaTrader). Messages appear in New → NinjaScript Output.

#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class TradeLoopSync : AddOnBase
    {
        private const string SyncKey = "__TRADELOOP_SYNC_KEY__";
        private const string SyncUrl = "__TRADELOOP_SYNC_URL__";
        private const string Version = "__TRADELOOP_ADDON_VERSION__";

        private const int FlushSeconds = 3;         // new fills go out within a few seconds
        private const int HeartbeatSeconds = 300;   // balances and "last seen" every 5 minutes
        private const int ResendSessionSeconds = 600; // the whole session again every 10 minutes (TradeLoop skips what it has)
        private const int MaxBatch = 1000;

        private readonly object gate = new object();
        private readonly Dictionary<string, string> pending = new Dictionary<string, string>();
        private readonly Dictionary<string, string> pendingOrders = new Dictionary<string, string>();
        private readonly Dictionary<string, string> pendingPositions = new Dictionary<string, string>();
        private readonly List<Account> watched = new List<Account>();
        private System.Threading.Timer timer;
        private int sending;
        private volatile bool stopped;
        private DateTime lastPost = DateTime.MinValue;
        private DateTime lastResend = DateTime.MinValue;
        private DateTime pausedUntil = DateTime.MinValue;
        private int failures;
        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "TradeLoop Sync";
                Description = "Sends your executions to your TradeLoop trading journal.";
            }
            else if (State == State.Active)
            {
                StartSync();
            }
            else if (State == State.Terminated)
            {
                StopSync();
            }
        }

        // ------------------------------------------------------------------ lifecycle

        private void StartSync()
        {
            if (!SyncKey.StartsWith("tlnt_"))
            {
                OutputNote("This copy of the add-on has no TradeLoop key. Download it again from TradeLoop: Accounts → Add account → Tradovate.");
                return;
            }
            stopped = false;
            try { ServicePointManager.SecurityProtocol = ServicePointManager.SecurityProtocol | SecurityProtocolType.Tls12; }
            catch (Exception) { }
            Account.AccountStatusUpdate += OnAccountStatusUpdate;
            List<Account> accounts = new List<Account>();
            lock (Account.All)
                foreach (Account account in Account.All)
                    accounts.Add(account);
            foreach (Account account in accounts)
                WatchAccount(account);
            timer = new System.Threading.Timer(OnTimer, null, 2000, FlushSeconds * 1000);
            OutputNote("TradeLoop Sync " + Version + " is running.");
        }

        private void StopSync()
        {
            if (stopped) return;
            stopped = true;
            if (timer != null) { timer.Dispose(); timer = null; }
            Account.AccountStatusUpdate -= OnAccountStatusUpdate;
            List<Account> accounts;
            lock (gate) { accounts = new List<Account>(watched); watched.Clear(); }
            foreach (Account account in accounts)
            {
                account.ExecutionUpdate -= OnExecutionUpdate;
                account.OrderUpdate -= OnOrderUpdate;
                account.PositionUpdate -= OnPositionUpdate;
            }
            // Last fills of the day: one quick attempt before NinjaTrader closes.
            try { SendPending(true, 5000); } catch (Exception) { }
        }

        private void WatchAccount(Account account)
        {
            if (account == null) return;
            lock (gate)
            {
                if (watched.Contains(account)) return;
                watched.Add(account);
            }
            account.ExecutionUpdate += OnExecutionUpdate;
            account.OrderUpdate += OnOrderUpdate;
            account.PositionUpdate += OnPositionUpdate;
            QueueSessionOf(account);
        }

        private void OnAccountStatusUpdate(object sender, AccountStatusEventArgs e)
        {
            if (stopped || e == null || e.Account == null) return;
            WatchAccount(e.Account);
            // A (re)connected account brings its session's executions — send them.
            if (e.Status.ToString() == "Connected") QueueSessionOf(e.Account);
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            if (stopped || e == null || e.Execution == null) return;
            QueueExecution(e.Execution);
        }

        // Orders and positions are read-only context for TradeLoop (the journal
        // is built from executions). Every OrderUpdate is sent, so TradeLoop
        // sees the whole lifecycle, not just the final state.
        private void OnOrderUpdate(object sender, OrderEventArgs e)
        {
            if (stopped || e == null || e.Order == null) return;
            QueueOrder(e.Order);
        }

        private void OnPositionUpdate(object sender, PositionEventArgs e)
        {
            if (stopped || e == null || e.Position == null) return;
            QueuePosition(e.Position);
        }

        // ------------------------------------------------------------------ reading

        // NinjaTrader's own simulation isn't a real account anywhere; prop-firm
        // evaluation accounts are, and arrive through a real connection.
        private static bool ShouldSync(Account account)
        {
            if (account == null || account.Connection == null) return false;
            string provider = ProviderName(account);
            if (provider == "Simulator" || provider == "Playback") return false;
            string name = account.Name ?? "";
            return name != "Sim101" && name != "Playback101" && name != "Backtest";
        }

        private void QueueSessionOf(Account account)
        {
            if (!ShouldSync(account)) return;
            List<Execution> executions = new List<Execution>();
            lock (account.Executions)
                foreach (Execution execution in account.Executions)
                    executions.Add(execution);
            foreach (Execution execution in executions)
                QueueExecution(execution);
            List<Order> orders = new List<Order>();
            lock (account.Orders)
                foreach (Order order in account.Orders)
                    orders.Add(order);
            foreach (Order order in orders)
                QueueOrder(order);
            List<Position> positions = new List<Position>();
            lock (account.Positions)
                foreach (Position position in account.Positions)
                    positions.Add(position);
            foreach (Position position in positions)
                QueuePosition(position);
        }

        private void QueueExecution(Execution execution)
        {
            try
            {
                Account account = execution.Account;
                if (!ShouldSync(account) || string.IsNullOrEmpty(execution.ExecutionId)) return;
                string json = ExecutionToJson(execution);
                if (json == null) return;
                lock (gate) pending[account.Name + "|" + execution.ExecutionId] = json;
            }
            catch (Exception err)
            {
                OutputNote("Couldn't read an execution: " + err.Message);
            }
        }

        private static string ExecutionToJson(Execution execution)
        {
            Instrument instrument = execution.Instrument;
            if (instrument == null || instrument.MasterInstrument == null) return null;
            MasterInstrument master = instrument.MasterInstrument;
            StringBuilder sb = new StringBuilder("{");
            JsonStr(sb, "account", execution.Account.Name);
            JsonStr(sb, "id", execution.ExecutionId);
            JsonStr(sb, "orderId", execution.OrderId);
            JsonStr(sb, "time", ToUtc(execution.Time).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", Invariant));
            JsonStr(sb, "root", master.Name);
            JsonStr(sb, "expiry", instrument.Expiry.Year > 1900 ? instrument.Expiry.ToString("yyyy-MM", Invariant) : null);
            JsonStr(sb, "instrumentType", master.InstrumentType.ToString());
            JsonStr(sb, "fullName", instrument.FullName);
            JsonNum(sb, "pointValue", master.PointValue);
            JsonNum(sb, "tickSize", master.TickSize);
            JsonStr(sb, "side", execution.MarketPosition == MarketPosition.Long ? "buy" : "sell");
            JsonNum(sb, "qty", execution.Quantity);
            JsonNum(sb, "price", execution.Price);
            JsonNum(sb, "commission", execution.Commission);
            return JsonEnd(sb, '}');
        }

        private void QueueOrder(Order order)
        {
            try
            {
                Account account = order.Account;
                if (!ShouldSync(account)) return;
                string id = order.OrderId;
                if (string.IsNullOrEmpty(id)) id = "id-" + order.Id.ToString(Invariant);
                string json = OrderToJson(order, account, id);
                if (json == null) return;
                lock (gate) pendingOrders[account.Name + "|" + id] = json;
            }
            catch (Exception err)
            {
                OutputNote("Couldn't read an order: " + err.Message);
            }
        }

        private void QueuePosition(Position position)
        {
            try
            {
                Account account = position.Account;
                if (!ShouldSync(account)) return;
                Instrument instrument = position.Instrument;
                if (instrument == null || instrument.MasterInstrument == null) return;
                string json = PositionToJson(position, account, instrument);
                if (json == null) return;
                lock (gate) pendingPositions[account.Name + "|" + instrument.FullName] = json;
            }
            catch (Exception err)
            {
                OutputNote("Couldn't read a position: " + err.Message);
            }
        }

        private static string OrderToJson(Order order, Account account, string id)
        {
            Instrument instrument = order.Instrument;
            if (instrument == null || instrument.MasterInstrument == null) return null;
            MasterInstrument master = instrument.MasterInstrument;
            StringBuilder sb = new StringBuilder("{");
            JsonStr(sb, "account", account.Name);
            JsonStr(sb, "id", id);
            JsonStr(sb, "root", master.Name);
            JsonStr(sb, "expiry", instrument.Expiry.Year > 1900 ? instrument.Expiry.ToString("yyyy-MM", Invariant) : null);
            JsonStr(sb, "instrumentType", master.InstrumentType.ToString());
            JsonStr(sb, "side", (order.OrderAction == OrderAction.Buy || order.OrderAction == OrderAction.BuyToCover) ? "buy" : "sell");
            JsonNum(sb, "qty", order.Quantity);
            JsonNum(sb, "filled", order.Filled);
            JsonNum(sb, "avgFillPrice", order.AverageFillPrice);
            JsonStr(sb, "orderType", order.OrderType.ToString());
            JsonStr(sb, "state", order.OrderState.ToString());
            JsonNum(sb, "limitPrice", order.LimitPrice);
            JsonNum(sb, "stopPrice", order.StopPrice);
            JsonStr(sb, "time", ToUtc(order.Time).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", Invariant));
            JsonStr(sb, "name", order.Name);
            JsonStr(sb, "oco", order.Oco);
            JsonStr(sb, "tif", order.TimeInForce.ToString());
            return JsonEnd(sb, '}');
        }

        private static string PositionToJson(Position position, Account account, Instrument instrument)
        {
            MasterInstrument master = instrument.MasterInstrument;
            StringBuilder sb = new StringBuilder("{");
            JsonStr(sb, "account", account.Name);
            JsonStr(sb, "root", master.Name);
            JsonStr(sb, "expiry", instrument.Expiry.Year > 1900 ? instrument.Expiry.ToString("yyyy-MM", Invariant) : null);
            JsonStr(sb, "instrumentType", master.InstrumentType.ToString());
            JsonStr(sb, "marketPosition", position.MarketPosition.ToString());
            JsonNum(sb, "qty", position.Quantity);
            JsonNum(sb, "avgPrice", position.AveragePrice);
            return JsonEnd(sb, '}');
        }

        private static string AccountToJson(Account account)
        {
            StringBuilder sb = new StringBuilder("{");
            JsonStr(sb, "name", account.Name);
            JsonStr(sb, "provider", ProviderName(account));
            JsonStr(sb, "connection", TextOf(PropertyOf(PropertyOf(account.Connection, "Options"), "Name")));
            JsonStr(sb, "status", TextOf(PropertyOf(account.Connection, "Status")));
            JsonStr(sb, "currency", account.Denomination.ToString());
            JsonNum(sb, "cashValue", AccountValue(account, "CashValue"));
            JsonNum(sb, "netLiquidation", AccountValue(account, "NetLiquidation"));
            JsonNum(sb, "realizedPnl", AccountValue(account, "RealizedProfitLoss"));
            return JsonEnd(sb, '}');
        }

        // Account values by AccountItem name, so a renamed item can't break the compile.
        private static double AccountValue(Account account, string item)
        {
            try
            {
                AccountItem value = (AccountItem)Enum.Parse(typeof(AccountItem), item);
                return account.Get(value, account.Denomination);
            }
            catch (Exception)
            {
                return double.NaN;
            }
        }

        private static string ProviderName(Account account)
        {
            return TextOf(PropertyOf(PropertyOf(account.Connection, "Options"), "Provider")) ?? "";
        }

        private static object PropertyOf(object target, string name)
        {
            if (target == null) return null;
            try
            {
                PropertyInfo p = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                return p == null ? null : p.GetValue(target, null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string TextOf(object value)
        {
            return value == null ? null : value.ToString();
        }

        // Execution times are in NinjaTrader's time zone (Tools → Options →
        // General); TradeLoop wants UTC.
        private static TimeZoneInfo zone;
        private static DateTime ToUtc(DateTime time)
        {
            if (time.Kind == DateTimeKind.Utc) return time;
            if (zone == null) zone = ConfiguredZone() ?? TimeZoneInfo.Local;
            try { return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(time, DateTimeKind.Unspecified), zone); }
            catch (Exception) { return DateTime.SpecifyKind(time, DateTimeKind.Local).ToUniversalTime(); }
        }

        private static TimeZoneInfo ConfiguredZone()
        {
            try
            {
                foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
                {
                    Type globals = assembly.GetType("NinjaTrader.Core.Globals", false);
                    if (globals == null) continue;
                    PropertyInfo options = globals.GetProperty("GeneralOptions", BindingFlags.Public | BindingFlags.Static);
                    object value = options == null ? null : options.GetValue(null, null);
                    return PropertyOf(value, "TimeZoneInfo") as TimeZoneInfo;
                }
            }
            catch (Exception) { }
            return null;
        }

        // ------------------------------------------------------------------ sending

        private void OnTimer(object state)
        {
            if (stopped) return;
            try { SendPending(false, 20000); }
            catch (Exception err) { OutputNote("Sync error: " + err.Message); }
        }

        private void SendPending(bool final, int timeoutMs)
        {
            if (Interlocked.Exchange(ref sending, 1) == 1) return;
            try
            {
                DateTime now = DateTime.UtcNow;
                if (!final && now < pausedUntil) return;
                List<Account> accounts;
                lock (gate) accounts = new List<Account>(watched);
                if (!final && (now - lastResend).TotalSeconds >= ResendSessionSeconds)
                {
                    lastResend = now;
                    foreach (Account account in accounts) QueueSessionOf(account);
                }
                Dictionary<string, string> batch = new Dictionary<string, string>();
                Dictionary<string, string> orderBatch = new Dictionary<string, string>();
                Dictionary<string, string> positionBatch = new Dictionary<string, string>();
                lock (gate)
                {
                    foreach (KeyValuePair<string, string> item in pending)
                    {
                        if (batch.Count >= MaxBatch) break;
                        batch[item.Key] = item.Value;
                    }
                    foreach (KeyValuePair<string, string> item in pendingOrders)
                    {
                        if (orderBatch.Count >= MaxBatch) break;
                        orderBatch[item.Key] = item.Value;
                    }
                    foreach (KeyValuePair<string, string> item in pendingPositions)
                    {
                        if (positionBatch.Count >= MaxBatch) break;
                        positionBatch[item.Key] = item.Value;
                    }
                }
                bool heartbeat = (now - lastPost).TotalSeconds >= HeartbeatSeconds;
                if (batch.Count == 0 && orderBatch.Count == 0 && positionBatch.Count == 0 && !heartbeat) return;

                StringBuilder body = new StringBuilder();
                body.Append("{\"v\":1,\"client\":{");
                StringBuilder client = new StringBuilder();
                JsonStr(client, "version", Version);
                JsonStr(client, "machine", Environment.MachineName);
                JsonStr(client, "timeZone", (zone ?? TimeZoneInfo.Local).Id);
                JsonStr(client, "os", OsDescription());
                int queued;
                lock (gate) queued = pending.Count + pendingOrders.Count + pendingPositions.Count;
                JsonNum(client, "queued", queued);
                body.Append(client.ToString().TrimEnd(','));
                body.Append("},\"accounts\":[");
                bool first = true;
                foreach (Account account in accounts)
                {
                    if (!ShouldSync(account)) continue;
                    if (!first) body.Append(',');
                    body.Append(AccountToJson(account));
                    first = false;
                }
                body.Append("],\"executions\":[");
                body.Append(string.Join(",", batch.Values.ToArray()));
                body.Append("],\"orders\":[");
                body.Append(string.Join(",", orderBatch.Values.ToArray()));
                body.Append("],\"positions\":[");
                body.Append(string.Join(",", positionBatch.Values.ToArray()));
                body.Append("]}");

                string response;
                int status = HttpPost(body.ToString(), timeoutMs, out response);
                if (status >= 200 && status < 300)
                {
                    lock (gate)
                    {
                        foreach (KeyValuePair<string, string> item in batch)
                        {
                            string current;
                            if (pending.TryGetValue(item.Key, out current) && current == item.Value) pending.Remove(item.Key);
                        }
                        foreach (KeyValuePair<string, string> item in orderBatch)
                        {
                            string current;
                            if (pendingOrders.TryGetValue(item.Key, out current) && current == item.Value) pendingOrders.Remove(item.Key);
                        }
                        foreach (KeyValuePair<string, string> item in positionBatch)
                        {
                            string current;
                            if (pendingPositions.TryGetValue(item.Key, out current) && current == item.Value) pendingPositions.Remove(item.Key);
                        }
                    }
                    lastPost = now;
                    if (failures > 0) OutputNote("Connected to TradeLoop again.");
                    failures = 0;
                }
                else if (status == 401)
                {
                    pausedUntil = now.AddHours(1);
                    OutputNote("TradeLoop doesn't accept this add-on's key any more. Download the add-on again from TradeLoop: Accounts → Add account → Tradovate.");
                }
                else if (status == 403)
                {
                    pausedUntil = now.AddHours(1);
                    OutputNote("TradeLoop: " + ErrorMessage(response, "this account can't sync right now."));
                }
                else
                {
                    failures++;
                    pausedUntil = now.AddSeconds(Math.Min(300, 5 * Math.Pow(2, Math.Min(failures, 6))));
                    if (failures == 1 || failures % 10 == 0) OutputNote("Couldn't reach TradeLoop (" + (status == 0 ? response : "HTTP " + status) + "). Retrying on its own.");
                }
            }
            finally
            {
                Interlocked.Exchange(ref sending, 0);
            }
        }

        private static int HttpPost(string json, int timeoutMs, out string response)
        {
            response = "";
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(SyncUrl);
                request.Method = "POST";
                request.ContentType = "application/json";
                request.Accept = "application/json";
                request.UserAgent = "TradeLoopSync/" + Version + " NinjaTrader";
                request.Headers["Authorization"] = "Bearer " + SyncKey;
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                request.ContentLength = bytes.Length;
                using (Stream stream = request.GetRequestStream())
                    stream.Write(bytes, 0, bytes.Length);
                using (HttpWebResponse res = (HttpWebResponse)request.GetResponse())
                {
                    response = ReadBody(res);
                    return (int)res.StatusCode;
                }
            }
            catch (WebException err)
            {
                HttpWebResponse res = err.Response as HttpWebResponse;
                if (res != null)
                {
                    using (res)
                    {
                        response = ReadBody(res);
                        return (int)res.StatusCode;
                    }
                }
                response = err.Message;
                return 0;
            }
            catch (Exception err)
            {
                response = err.Message;
                return 0;
            }
        }

        private static string ReadBody(HttpWebResponse res)
        {
            using (Stream stream = res.GetResponseStream())
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                return reader.ReadToEnd();
        }

        // {"error":"…"} → the message, for the Output window.
        private static string ErrorMessage(string json, string fallback)
        {
            if (string.IsNullOrEmpty(json)) return fallback;
            int at = json.IndexOf("\"error\":\"", StringComparison.Ordinal);
            if (at < 0) return fallback;
            int start = at + 9;
            int end = json.IndexOf('"', start);
            return end > start ? json.Substring(start, end - start) : fallback;
        }

        // ------------------------------------------------------------------ JSON

        private static void JsonStr(StringBuilder sb, string key, string value)
        {
            sb.Append('"').Append(key).Append("\":");
            if (value == null) { sb.Append("null,"); return; }
            sb.Append('"');
            foreach (char c in value)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", Invariant));
                else sb.Append(c);
            }
            sb.Append("\",");
        }

        private static void JsonNum(StringBuilder sb, string key, double value)
        {
            sb.Append('"').Append(key).Append("\":");
            if (double.IsNaN(value) || double.IsInfinity(value)) sb.Append("null,");
            else sb.Append(value.ToString("R", Invariant)).Append(',');
        }

        private static string JsonEnd(StringBuilder sb, char end)
        {
            if (sb.Length > 1 && sb[sb.Length - 1] == ',') sb.Length--;
            return sb.Append(end).ToString();
        }

        private static string OsDescription()
        {
            try { return Environment.OSVersion.ToString(); }
            catch (Exception) { return null; }
        }

        private static void OutputNote(string message)
        {
            NinjaTrader.Code.Output.Process("[TradeLoop] " + message, PrintTo.OutputTab1);
        }
    }
}
`

// TradeLoop Provision: appended to the file for TradeLoop's own server only (see the top of this file).
const PROVISION_TEMPLATE = String.raw`

// ---------------------------------------------------------------------------
// TradeLoop Provision — only in the copy that runs on TradeLoop's own server.
//
// Keeps one NinjaTrader connection for each Tradovate login a trader entered in
// TradeLoop. The logins come from the TradeLoop worker on this machine
// (127.0.0.1); each is used to make its connection and nothing else: not
// written to a file, not added to NinjaTrader's saved connections, not printed.
// It connects and disconnects. It never places, changes or cancels an order.
namespace NinjaTrader.NinjaScript.AddOns
{
    public class TradeLoopProvision : AddOnBase
    {
        private const string ProvisionUrl = "__TRADELOOP_PROVISION_URL__";
        private const string ProvisionToken = "__TRADELOOP_PROVISION_TOKEN__";

        private static int PollSeconds = 15;       // how often the list of logins is read
        private static int RetrySeconds = 60;      // a login that didn't connect is tried again after this, then twice as long each time
        private static int MaxRetrySeconds = 900;  // ... up to this
        private const int RefusalsToReject = 2;   // refused this many times running, the trader is asked to enter it again
        private const string Prefix = "tl-";      // the connections that are ours; any other connection here is left alone

        private sealed class Login
        {
            public string Id;
            public string Name;
            public string AccountType;
            public string User;
            public string Password;
            public string Status;
        }

        // What has been tried for one connection name.
        private sealed class Attempt
        {
            public string Id;
            public string User;
            public string Password;
            public DateTime NextTry = DateTime.MinValue;
            public int Tries;
            public int Refusals;
            public bool Rejected;
            public bool SaidConnected;
        }

        private readonly object gate = new object();
        private readonly Dictionary<string, Attempt> attempts = new Dictionary<string, Attempt>(StringComparer.OrdinalIgnoreCase);
        private System.Threading.Timer timer;
        private int busy;
        private volatile bool stopped;
        private bool saidUnreachable;
        private bool saidNoType;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "TradeLoop Provision";
                Description = "Keeps the Tradovate logins traders entered in TradeLoop connected.";
            }
            else if (State == State.Active)
            {
                Start();
            }
            else if (State == State.Terminated)
            {
                Stop();
            }
        }

        private void Start()
        {
            if (!ProvisionUrl.StartsWith("http://127.0.0.1:"))
            {
                Note("This copy has no worker to ask. Nothing to do.");
                return;
            }
            stopped = false;
            AllowSeveralConnections();
            Connection.ConnectionStatusUpdate += OnConnectionStatusUpdate;
            timer = new System.Threading.Timer(OnTimer, null, Math.Min(5000, PollSeconds * 1000), PollSeconds * 1000);
            Note("TradeLoop Provision is running.");
        }

        // The connections are left as they are: NinjaTrader closes them itself when it
        // closes, and a recompile of this file finds them again by name.
        private void Stop()
        {
            if (stopped) return;
            stopped = true;
            if (timer != null) { timer.Dispose(); timer = null; }
            Connection.ConnectionStatusUpdate -= OnConnectionStatusUpdate;
        }

        private void OnTimer(object state)
        {
            if (stopped) return;
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try { Reconcile(); }
            catch (Exception err) { Note("Couldn't bring the connections in step: " + err.GetType().Name + "."); }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        // ------------------------------------------------------------------ in step

        private void Reconcile()
        {
            string body;
            int status = Http("GET", ProvisionUrl + "/provision?format=lines", null, 15000, out body);
            if (status != 200)
            {
                if (!saidUnreachable) Note("Can't reach the TradeLoop worker (" + (status == 0 ? "no answer" : "HTTP " + status) + "). Connections stay as they are; trying again on its own.");
                saidUnreachable = true;
                return;
            }
            if (saidUnreachable) Note("Reached the TradeLoop worker again.");
            saidUnreachable = false;

            Dictionary<string, Login> wanted = Parse(body);

            List<Connection> live = new List<Connection>();
            lock (Connection.Connections)
                foreach (Connection connection in Connection.Connections)
                    live.Add(connection);

            // 1. What is connected and shouldn't be: taken out in TradeLoop, refused and
            //    waiting for the trader, or entered again with another password.
            Dictionary<string, Connection> ours = new Dictionary<string, Connection>(StringComparer.OrdinalIgnoreCase);
            foreach (Connection connection in live)
            {
                string name = NameOf(connection);
                if (name == null || !name.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) continue;
                Login login;
                if (!wanted.TryGetValue(name, out login) || !SameLogin(connection, login))
                {
                    try { connection.Disconnect(); } catch (Exception) { }
                    Note(name + ": disconnected.");
                    continue;
                }
                ours[name] = connection;
            }
            lock (gate)
            {
                List<string> gone = new List<string>();
                foreach (string name in attempts.Keys)
                    if (!wanted.ContainsKey(name)) gone.Add(name);
                foreach (string name in gone) attempts.Remove(name);
            }

            // 2. What should be connected and isn't. One new login a pass, so a restart
            //    with many logins doesn't arrive at Tradovate all at once.
            DateTime now = DateTime.UtcNow;
            foreach (Login login in wanted.Values)
            {
                Attempt attempt = AttemptFor(login);
                Connection connection;
                if (ours.TryGetValue(login.Name, out connection))
                {
                    if (connection.Status == ConnectionStatus.Connected) Connected(login.Name);
                    continue;
                }
                bool due;
                lock (gate)
                {
                    due = !attempt.Rejected && now >= attempt.NextTry;
                    if (due)
                    {
                        attempt.Tries++;
                        attempt.NextTry = now.AddSeconds(Math.Min(MaxRetrySeconds, RetrySeconds * Math.Pow(2, Math.Min(attempt.Tries - 1, 4))));
                    }
                }
                if (!due) continue;
                Open(login);
                break;
            }
        }

        // The lines the worker sends: id, connection name, live|simulation, username
        // and password in base64, status; tabs between. A login the trader has to
        // enter again ("reauth") isn't wanted until they have.
        private static Dictionary<string, Login> Parse(string body)
        {
            Dictionary<string, Login> wanted = new Dictionary<string, Login>(StringComparer.OrdinalIgnoreCase);
            foreach (string raw in (body ?? "").Split('\n'))
            {
                string[] f = raw.TrimEnd('\r').Split('\t');
                if (f.Length != 6) continue;
                Login login = new Login();
                login.Id = f[0];
                login.Name = f[1];
                login.AccountType = f[2];
                login.Status = f[5];
                try
                {
                    login.User = Encoding.UTF8.GetString(Convert.FromBase64String(f[3]));
                    login.Password = Encoding.UTF8.GetString(Convert.FromBase64String(f[4]));
                }
                catch (Exception) { continue; }
                int id;
                if (!int.TryParse(login.Id, NumberStyles.None, CultureInfo.InvariantCulture, out id)) continue;
                if (!login.Name.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) continue;
                if (login.User.Length == 0 || login.Password.Length == 0) continue;
                if (login.Status == "reauth" || login.Status == "disconnected") continue;
                wanted[login.Name] = login;
            }
            return wanted;
        }

        private Attempt AttemptFor(Login login)
        {
            lock (gate)
            {
                Attempt attempt;
                if (!attempts.TryGetValue(login.Name, out attempt) || attempt.User != login.User || attempt.Password != login.Password)
                {
                    // new, or entered again: what was tried before doesn't count against it
                    attempt = new Attempt();
                    attempt.User = login.User;
                    attempt.Password = login.Password;
                    attempts[login.Name] = attempt;
                }
                attempt.Id = login.Id;
                return attempt;
            }
        }

        private static string NameOf(Connection connection)
        {
            try { return connection == null || connection.Options == null ? null : connection.Options.Name; }
            catch (Exception) { return null; }
        }

        private static bool SameLogin(Connection connection, Login login)
        {
            try { return connection.Options.User == login.User && connection.Options.Password == login.Password; }
            catch (Exception) { return true; }
        }

        // ------------------------------------------------------------------ connecting

        private void Open(Login login)
        {
            ConnectOptions options = NewOptions(login);
            if (options == null)
            {
                if (!saidNoType) Note("This NinjaTrader has no Tradovate connection type; no login can be connected.");
                saidNoType = true;
                return;
            }
            Note(login.Name + ": connecting.");
            try
            {
                // What becomes of it arrives in OnConnectionStatusUpdate.
                Connection.Connect(options);
            }
            catch (Exception err)
            {
                Note(login.Name + ": the connection couldn't be started (" + err.GetType().Name + ").");
            }
        }

        // NinjaTrader's own connection to Tradovate (the one its Connections menu calls
        // "NinjaTrader"). It isn't in the documented add-on API, so it is found by name;
        // the documented ConnectOptions members carry the login.
        private static ConnectOptions NewOptions(Login login)
        {
            try
            {
                Type type = typeof(Connection).Assembly.GetType("NinjaTrader.Cbi.TradovateOptions", false);
                if (type == null) return null;
                ConnectOptions options = Activator.CreateInstance(type) as ConnectOptions;
                if (options == null) return null;
                options.Name = login.Name;
                options.User = login.User;
                options.Password = login.Password;
                options.ConnectOnStartup = false;
                PropertyInfo accountType = type.GetProperty("AccountType", BindingFlags.Public | BindingFlags.Instance);
                if (accountType != null && accountType.CanWrite && accountType.PropertyType.IsEnum)
                    accountType.SetValue(options, Enum.Parse(accountType.PropertyType, login.AccountType == "live" ? "Live" : "Simulation"), null);
                return options;
            }
            catch (Exception)
            {
                return null;
            }
        }

        // NinjaTrader connects one thing at a time unless "Multi-provider" is on
        // (Tools → Options → General). Here there is a connection per trader.
        private static void AllowSeveralConnections()
        {
            try
            {
                Type globals = typeof(Connection).Assembly.GetType("NinjaTrader.Core.Globals", false);
                PropertyInfo general = globals == null ? null : globals.GetProperty("GeneralOptions", BindingFlags.Public | BindingFlags.Static);
                object options = general == null ? null : general.GetValue(null, null);
                PropertyInfo multi = options == null ? null : options.GetType().GetProperty("MultiProvider", BindingFlags.Public | BindingFlags.Instance);
                if (multi != null && multi.CanWrite && multi.PropertyType == typeof(bool) && !(bool)multi.GetValue(options, null))
                {
                    multi.SetValue(options, true, null);
                    Note("Multi-provider was off; switched on for this session.");
                }
            }
            catch (Exception) { }
        }

        private void OnConnectionStatusUpdate(object sender, ConnectionStatusEventArgs e)
        {
            if (stopped || e == null || e.Connection == null) return;
            string name = NameOf(e.Connection);
            if (name == null || !name.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return;
            if (e.Status == ConnectionStatus.Connected)
            {
                Connected(name);
                return;
            }
            lock (gate)
            {
                Attempt attempt;
                if (attempts.TryGetValue(name, out attempt)) attempt.SaidConnected = false;
            }
            if (e.Error == ErrorCode.LogOnFailed) Refused(name, e.NativeError);
        }

        private void Connected(string name)
        {
            string id = null;
            lock (gate)
            {
                Attempt attempt;
                if (!attempts.TryGetValue(name, out attempt) || attempt.SaidConnected) return;
                attempt.SaidConnected = true;
                attempt.Tries = 0;
                attempt.Refusals = 0;
                attempt.NextTry = DateTime.MinValue;
                id = attempt.Id;
            }
            Note(name + ": connected.");
            Report(id, "connected", null);
        }

        // Tradovate said no to the login itself. Twice running, and it stops being
        // tried: the trader is told, and entering it again in TradeLoop starts it over.
        private void Refused(string name, string nativeError)
        {
            string id = null;
            string password = null;
            lock (gate)
            {
                Attempt attempt;
                if (!attempts.TryGetValue(name, out attempt) || attempt.Rejected) return;
                attempt.Refusals++;
                if (attempt.Refusals < RefusalsToReject) return;
                attempt.Rejected = true;
                id = attempt.Id;
                password = attempt.Password;
            }
            Note(name + ": Tradovate refused the login. Waiting for the trader to enter it again.");
            string said = (nativeError ?? "").Trim();
            // what Tradovate said goes to the trader only if it is short and can't be carrying the password back
            bool usable = said.Length > 0 && said.Length <= 160 && said.IndexOf(password, StringComparison.Ordinal) < 0;
            Report(id, "reauth", usable ? "Tradovate didn't accept this login: " + said : "Tradovate didn't accept this username and password.");
        }

        // ------------------------------------------------------------------ telling the worker

        private void Report(string id, string status, string message)
        {
            if (id == null) return;
            StringBuilder sb = new StringBuilder("{\"id\":").Append(id).Append(",\"status\":\"").Append(status).Append('"');
            if (message != null)
            {
                sb.Append(",\"message\":\"");
                foreach (char c in message)
                {
                    if (c == '"') sb.Append("\\\"");
                    else if (c == '\\') sb.Append("\\\\");
                    else if (c < ' ') sb.Append(' ');
                    else sb.Append(c);
                }
                sb.Append('"');
            }
            string json = sb.Append('}').ToString();
            // not on NinjaTrader's own thread: the event that led here must not wait for the network
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                string response;
                for (int i = 0; i < 3 && !stopped; i++)
                {
                    int code = Http("POST", ProvisionUrl + "/report", json, 10000, out response);
                    if (code >= 200 && code < 300) return;
                    Thread.Sleep(5000);
                }
            });
        }

        private static int Http(string method, string url, string json, int timeoutMs, out string response)
        {
            response = "";
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = method;
                request.Proxy = null;
                request.Accept = "*/*";
                request.UserAgent = "TradeLoopProvision NinjaTrader";
                request.Headers["Authorization"] = "Bearer " + ProvisionToken;
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                if (json != null)
                {
                    request.ContentType = "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    request.ContentLength = bytes.Length;
                    using (Stream stream = request.GetRequestStream())
                        stream.Write(bytes, 0, bytes.Length);
                }
                using (HttpWebResponse res = (HttpWebResponse)request.GetResponse())
                using (Stream stream = res.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    response = reader.ReadToEnd();
                    return (int)res.StatusCode;
                }
            }
            catch (WebException err)
            {
                HttpWebResponse res = err.Response as HttpWebResponse;
                if (res == null) return 0;
                using (res) return (int)res.StatusCode;
            }
            catch (Exception)
            {
                return 0;
            }
        }

        private static void Note(string message)
        {
            NinjaTrader.Code.Output.Process("[TradeLoop] " + message, PrintTo.OutputTab1);
        }
    }
}
`
