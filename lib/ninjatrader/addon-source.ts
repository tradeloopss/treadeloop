// The TradeLoop add-on for NinjaTrader 8 (C#, NinjaScript). Served by
// POST /api/ninjatrader/addon with the trader's own sync key filled in; the
// trader drops it into Documents\NinjaTrader 8\bin\Custom\AddOns.
//
// It uses only NinjaScript's documented add-on API — Account.All,
// Account.AccountStatusUpdate, Account.ExecutionUpdate, Account.Executions,
// Account.Get, Execution, Instrument, MasterInstrument — to read the
// trader's own executions inside their own NinjaTrader, and posts them to
// TradeLoop over HTTPS. It never places, changes or cancels orders, and holds
// no broker password. Written for C# 5 (no string interpolation, no ?.)
// so it compiles in any NinjaTrader 8 release; anything not in the documented
// API (the time zone setting, the connection's provider name) is read by
// reflection with a safe fallback, so a NinjaTrader update can't break the
// compile. Checked by compiling against stand-ins of those types
// (tests/ninjatrader/, csc).

export const ADDON_VERSION = "1.0.0"
export const ADDON_FILENAME = "TradeLoopSync.cs"

export function addonSource(opts: { key: string; syncUrl: string }): string {
  if (!/^tlnt_[A-Za-z0-9_-]{20,}$/.test(opts.key)) throw new Error("invalid add-on key")
  if (!/^https?:\/\/[A-Za-z0-9.:/_-]+$/.test(opts.syncUrl)) throw new Error("invalid sync URL")
  return TEMPLATE.split("__TRADELOOP_SYNC_KEY__")
    .join(opts.key)
    .split("__TRADELOOP_SYNC_URL__")
    .join(opts.syncUrl)
    .split("__TRADELOOP_ADDON_VERSION__")
    .join(ADDON_VERSION)
    .replace(/\r?\n/g, "\r\n")
}

const TEMPLATE = String.raw`// TradeLoop Sync — NinjaTrader 8 add-on, version __TRADELOOP_ADDON_VERSION__
//
// Sends the executions (fills) of the accounts connected in this NinjaTrader
// to your TradeLoop journal, where they become trades with P&L. Works with
// prop-firm Tradovate accounts (Apex, Tradeify, MyFundedFutures…) connected
// through NinjaTrader's "NinjaTrader" connection, and with other brokers.
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
                account.ExecutionUpdate -= OnExecutionUpdate;
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
                lock (gate)
                    foreach (KeyValuePair<string, string> item in pending)
                    {
                        if (batch.Count >= MaxBatch) break;
                        batch[item.Key] = item.Value;
                    }
                bool heartbeat = (now - lastPost).TotalSeconds >= HeartbeatSeconds;
                if (batch.Count == 0 && !heartbeat) return;

                StringBuilder body = new StringBuilder();
                body.Append("{\"v\":1,\"client\":{");
                StringBuilder client = new StringBuilder();
                JsonStr(client, "version", Version);
                JsonStr(client, "machine", Environment.MachineName);
                JsonStr(client, "timeZone", (zone ?? TimeZoneInfo.Local).Id);
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
                body.Append("]}");

                string response;
                int status = HttpPost(body.ToString(), timeoutMs, out response);
                if (status >= 200 && status < 300)
                {
                    lock (gate)
                        foreach (KeyValuePair<string, string> item in batch)
                        {
                            string current;
                            if (pending.TryGetValue(item.Key, out current) && current == item.Value) pending.Remove(item.Key);
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

        private static void OutputNote(string message)
        {
            NinjaTrader.Code.Output.Process("[TradeLoop] " + message, PrintTo.OutputTab1);
        }
    }
}
`
