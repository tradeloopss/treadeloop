// The TradeLoop VPS Agent (C#). A small read-only Windows background process
// deployed by provisioning onto a TradeLoop-managed VPS alongside NinjaTrader 8
// and the TradeLoopSync add-on. It supervises the environment and relays its
// health to TradeLoop, and runs only safe, read-only commands. It NEVER places,
// changes, cancels or closes an order — all trading reads happen in the add-on
// via NinjaScript; the agent only checks processes and relays status.
//
// BCL-only (HttpWebRequest, Timer, Process), written for an older C# so it
// compiles with csc without NinjaTrader or any third-party reference — see
// tests/vps/agent.test.ts. The real deployment packages it as a Windows service
// (sc.exe / New-Service) with automatic startup; see docs/vps-agent.md.

export const AGENT_VERSION = "1.0.0"
export const AGENT_FILENAME = "TradeLoopVpsAgent.cs"

export function agentSource(opts: { key: string; cloudUrl: string }): string {
  if (!/^tlnt_[A-Za-z0-9_-]{20,}$/.test(opts.key)) throw new Error("invalid agent key")
  if (!/^https?:\/\/[A-Za-z0-9.:/_-]+$/.test(opts.cloudUrl)) throw new Error("invalid cloud URL")
  return TEMPLATE.split("__TRADELOOP_AGENT_KEY__").join(opts.key).split("__TRADELOOP_CLOUD_URL__").join(opts.cloudUrl).split("__TRADELOOP_AGENT_VERSION__").join(AGENT_VERSION).replace(/\r?\n/g, "\r\n")
}

const TEMPLATE = String.raw`// TradeLoop VPS Agent __TRADELOOP_AGENT_VERSION__ — read-only health relay.
#region Using declarations
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
#endregion

namespace TradeLoop
{
    public static class VpsAgent
    {
        private const string AgentKey = "__TRADELOOP_AGENT_KEY__";
        private const string CloudUrl = "__TRADELOOP_CLOUD_URL__";
        private const string Version = "__TRADELOOP_AGENT_VERSION__";
        private const int HeartbeatSeconds = 30;
        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;
        private static volatile bool stopped;

        public static void Main()
        {
            try { ServicePointManager.SecurityProtocol = ServicePointManager.SecurityProtocol | SecurityProtocolType.Tls12; }
            catch (Exception) { }
            Log("TradeLoop VPS Agent " + Version + " started.");
            while (!stopped)
            {
                try { Tick(); }
                catch (Exception err) { Log("tick error: " + err.Message); }
                Thread.Sleep(HeartbeatSeconds * 1000);
            }
        }

        // Called once per cycle: report health, then run one pending command.
        private static void Tick()
        {
            Heartbeat();
            string id, command;
            if (NextCommand(out id, out command)) RunCommand(id, command);
        }

        private static bool NinjaTraderRunning()
        {
            try { return Process.GetProcessesByName("NinjaTrader").Length > 0; }
            catch (Exception) { return false; }
        }

        private static void Heartbeat()
        {
            StringBuilder sb = new StringBuilder("{");
            sb.Append("\"agentUp\":true,");
            sb.Append("\"ninjaTraderRunning\":").Append(NinjaTraderRunning() ? "true" : "false").Append(',');
            sb.Append("\"version\":\"").Append(Version).Append("\"}");
            string body;
            Post(CloudUrl + "/heartbeat", sb.ToString(), out body);
        }

        // GET /commands -> {"command":{"id":1,"command":"ping"}} or {"command":null}
        private static bool NextCommand(out string id, out string command)
        {
            id = null; command = null;
            string body;
            int status = Get(CloudUrl + "/commands", out body);
            if (status < 200 || status >= 300 || string.IsNullOrEmpty(body)) return false;
            command = JsonField(body, "command");
            id = JsonField(body, "id");
            return !string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(command);
        }

        // All commands are read-only. No order is ever placed, changed or cancelled.
        private static void RunCommand(string id, string command)
        {
            bool ok = true;
            string result = "";
            switch (command)
            {
                case "ping":
                    result = "pong";
                    break;
                case "health":
                    result = "ninjaTraderRunning=" + (NinjaTraderRunning() ? "true" : "false");
                    break;
                case "sync_now":
                case "reconcile":
                    // The add-on inside NinjaTrader does the actual (re)sync; the agent only acknowledges.
                    result = "acknowledged";
                    break;
                case "reconnect":
                    result = EnsureNinjaTrader();
                    break;
                case "collect_logs":
                    result = TailLog();
                    break;
                default:
                    ok = false;
                    result = "unsupported command";
                    break;
            }
            string body;
            Post(CloudUrl + "/command-result", "{\"id\":" + id + ",\"ok\":" + (ok ? "true" : "false") + ",\"result\":\"" + Escape(result) + "\"}", out body);
        }

        // Make sure NinjaTrader is running; start it from its known location if not.
        // This restarts the platform only — it cannot and does not touch any order.
        private static string EnsureNinjaTrader()
        {
            if (NinjaTraderRunning()) return "already running";
            string exe = Environment.GetEnvironmentVariable("TRADELOOP_NINJATRADER_EXE");
            if (string.IsNullOrEmpty(exe) || !File.Exists(exe)) return "NinjaTrader not running; no launch path configured";
            try { Process.Start(exe); return "launched"; }
            catch (Exception err) { return "launch failed: " + err.Message; }
        }

        private static string TailLog()
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NinjaTrader 8", "log");
                if (!Directory.Exists(dir)) return "no log directory";
                string latest = null;
                DateTime newest = DateTime.MinValue;
                foreach (string f in Directory.GetFiles(dir, "*.txt"))
                {
                    DateTime t = File.GetLastWriteTimeUtc(f);
                    if (t > newest) { newest = t; latest = f; }
                }
                if (latest == null) return "no log files";
                string all = File.ReadAllText(latest);
                return all.Length > 400 ? all.Substring(all.Length - 400) : all;
            }
            catch (Exception err) { return "log read failed: " + err.Message; }
        }

        // ---------------- HTTP (device-key bearer auth) ----------------

        private static int Get(string url, out string body)
        {
            return Send("GET", url, null, out body);
        }

        private static int Post(string url, string json, out string body)
        {
            return Send("POST", url, json, out body);
        }

        private static int Send(string method, string url, string json, out string body)
        {
            body = "";
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = method;
                req.Accept = "application/json";
                req.UserAgent = "TradeLoopVpsAgent/" + Version;
                req.Headers["Authorization"] = "Bearer " + AgentKey;
                req.Timeout = 20000;
                req.ReadWriteTimeout = 20000;
                if (json != null)
                {
                    req.ContentType = "application/json";
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    req.ContentLength = bytes.Length;
                    using (Stream s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                }
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    body = r.ReadToEnd();
                    return (int)res.StatusCode;
                }
            }
            catch (WebException err)
            {
                HttpWebResponse res = err.Response as HttpWebResponse;
                if (res != null) using (res) return (int)res.StatusCode;
                return 0;
            }
            catch (Exception) { return 0; }
        }

        // Minimal JSON field reader for flat objects: "key":"value" or "key":number.
        private static string JsonField(string json, string key)
        {
            string needle = "\"" + key + "\":";
            int at = json.IndexOf(needle, StringComparison.Ordinal);
            if (at < 0) return null;
            int i = at + needle.Length;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
            if (i >= json.Length) return null;
            if (json[i] == 'n') return null; // null
            if (json[i] == '"')
            {
                int end = json.IndexOf('"', i + 1);
                return end > i ? json.Substring(i + 1, end - i - 1) : null;
            }
            int j = i;
            while (j < json.Length && (char.IsDigit(json[j]) || json[j] == '-')) j++;
            return j > i ? json.Substring(i, j - i) : null;
        }

        private static string Escape(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < ' ') sb.Append(' ');
                else sb.Append(c);
            }
            return sb.ToString();
        }

        private static void Log(string message)
        {
            Console.WriteLine("[TradeLoop] " + message);
        }
    }
}
`
