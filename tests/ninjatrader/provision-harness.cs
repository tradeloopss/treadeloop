// Drives TradeLoop Provision (the add-on that runs on TradeLoop's own server)
// against the stand-ins in stubs.cs: "Tradovate" here accepts any login whose
// password isn't "wrong". addon.test.ts plays the worker, changes the list of
// logins as this runs, and reads what was asked of NinjaTrader from the output.
// Test-only.
using System;
using System.Reflection;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.AddOns;

public static class ProvisionHarness
{
    private static void Set(string field, int value)
    {
        typeof(TradeLoopProvision).GetField(field, BindingFlags.NonPublic | BindingFlags.Static).SetValue(null, value);
    }

    public static void Main(string[] args)
    {
        // a second, not a quarter of a minute; a retry after one second, not a minute
        Set("PollSeconds", 1);
        Set("RetrySeconds", 1);
        Set("MaxRetrySeconds", 2);
        Connection.Verdict = delegate(ConnectOptions options) { return options.Password == "wrong" ? "Incorrect username or password" : null; };
        // the operator's own connection: not one of ours, and not to be touched
        Connection own = new Connection { Options = new ConnectOptions { Name = "My NinjaTrader", User = "operator" }, Status = ConnectionStatus.Connected };
        Connection.Connections.Add(own);

        TradeLoopProvision addOn = new TradeLoopProvision();
        addOn.SetStateForTest(State.SetDefaults);
        addOn.SetStateForTest(State.Active);
        Thread.Sleep(int.Parse(args[0]));
        addOn.SetStateForTest(State.Terminated);

        lock (Connection.Asked)
            foreach (string line in Connection.Asked)
                Console.WriteLine("ASKED " + line);
        lock (Connection.Connections)
            foreach (Connection connection in Connection.Connections)
                Console.WriteLine("LIVE " + connection.Options.Name + " " + connection.Options.User + " " + connection.Status);
        Console.WriteLine("MULTI " + NinjaTrader.Core.Globals.GeneralOptions.MultiProvider);
        Console.WriteLine("harness done");
    }
}
