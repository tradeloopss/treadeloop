// Stand-ins for the parts of NinjaTrader 8's NinjaScript API the TradeLoop
// add-on uses, shaped after the documented members (Account, Execution,
// Instrument, MasterInstrument, AddOnBase…). They let the add-on be compiled
// with the C# 5 compiler and driven by harness.cs without NinjaTrader —
// see tests/ninjatrader/addon.test.ts. Test-only; never shipped.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace NinjaTrader.NinjaScript
{
    public enum State { SetDefaults, Configure, Active, Terminated }
    public enum PrintTo { OutputTab1, OutputTab2 }

    public abstract class AddOnBase
    {
        public string Name { get; set; }
        public string Description { get; set; }
        public State State { get; private set; }
        protected virtual void OnStateChange() { }
        // Test hook: NinjaTrader drives the states itself.
        public void SetStateForTest(State state) { State = state; OnStateChange(); }
    }
}

namespace NinjaTrader.Code
{
    public static class Output
    {
        public static void Process(string message, NinjaTrader.NinjaScript.PrintTo tab) { Console.WriteLine(message); }
    }
}

namespace NinjaTrader.Core
{
    public class GeneralOptionsStub
    {
        public TimeZoneInfo TimeZoneInfo { get { return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time"); } }
    }

    public static class Globals
    {
        private static readonly GeneralOptionsStub options = new GeneralOptionsStub();
        public static GeneralOptionsStub GeneralOptions { get { return options; } }
    }
}

namespace NinjaTrader.Cbi
{
    public enum Currency { UsDollar, Euro }
    public enum AccountItem { CashValue, NetLiquidation, RealizedProfitLoss }
    public enum ConnectionStatus { Connected, Disconnected, ConnectionLost }
    public enum MarketPosition { Flat, Long, Short }
    public enum InstrumentType { Future, Stock, Forex, Cfd, Option }
    public enum Provider { NinjaTrader, Tradovate, Rithmic, Simulator, Playback }

    public class ConnectionOptions
    {
        public Provider Provider { get; set; }
        public string Name { get; set; }
    }

    public class Connection
    {
        public ConnectionOptions Options { get; set; }
        public ConnectionStatus Status { get; set; }
    }

    public class MasterInstrument
    {
        public string Name { get; set; }
        public double PointValue { get; set; }
        public double TickSize { get; set; }
        public InstrumentType InstrumentType { get; set; }
    }

    public class Instrument
    {
        public string FullName { get; set; }
        public DateTime Expiry { get; set; }
        public MasterInstrument MasterInstrument { get; set; }
    }

    public class Execution
    {
        public Account Account { get; set; }
        public string ExecutionId { get; set; }
        public string OrderId { get; set; }
        public Instrument Instrument { get; set; }
        public MarketPosition MarketPosition { get; set; }
        public int Quantity { get; set; }
        public double Price { get; set; }
        public double Commission { get; set; }
        public DateTime Time { get; set; }
    }

    public class ExecutionEventArgs : EventArgs
    {
        public Execution Execution { get; set; }
    }

    public class AccountStatusEventArgs : EventArgs
    {
        public Account Account { get; set; }
        public ConnectionStatus Status { get; set; }
    }

    public class Account
    {
        public static readonly List<Account> All = new List<Account>();
        public static event EventHandler<AccountStatusEventArgs> AccountStatusUpdate;
        public event EventHandler<ExecutionEventArgs> ExecutionUpdate;

        private readonly Dictionary<AccountItem, double> values = new Dictionary<AccountItem, double>();

        public Account(string name, Provider provider, string connection, double cash)
        {
            Name = name;
            Denomination = Currency.UsDollar;
            Executions = new Collection<Execution>();
            Connection = new Connection { Options = new ConnectionOptions { Provider = provider, Name = connection }, Status = ConnectionStatus.Connected };
            values[AccountItem.CashValue] = cash;
            values[AccountItem.NetLiquidation] = cash;
            values[AccountItem.RealizedProfitLoss] = 0;
        }

        public string Name { get; private set; }
        public Connection Connection { get; set; }
        public Currency Denomination { get; set; }
        public Collection<Execution> Executions { get; private set; }

        public double Get(AccountItem item, Currency currency)
        {
            double v;
            return values.TryGetValue(item, out v) ? v : 0;
        }

        // Test hooks: what NinjaTrader does when a fill arrives / an account connects.
        public void RaiseExecution(Execution execution)
        {
            lock (Executions) Executions.Add(execution);
            EventHandler<ExecutionEventArgs> handler = ExecutionUpdate;
            if (handler != null) handler(this, new ExecutionEventArgs { Execution = execution });
        }

        public static void RaiseStatus(Account account, ConnectionStatus status)
        {
            EventHandler<AccountStatusEventArgs> handler = AccountStatusUpdate;
            if (handler != null) handler(null, new AccountStatusEventArgs { Account = account, Status = status });
        }
    }
}
