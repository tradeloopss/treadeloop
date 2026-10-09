// Drives the compiled TradeLoop add-on through a short NinjaTrader session
// against the stand-ins in stubs.cs (see addon.test.ts, which runs this and
// captures what the add-on posts). Test-only.
using System;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.AddOns;

public static class Harness
{
    private static Instrument Es()
    {
        return new Instrument
        {
            FullName = "ES 12-25",
            Expiry = new DateTime(2025, 12, 19),
            MasterInstrument = new MasterInstrument { Name = "ES", PointValue = 50, TickSize = 0.25, InstrumentType = InstrumentType.Future },
        };
    }

    private static Execution Fill(Account account, string id, MarketPosition side, int qty, double price, double commission, DateTime time)
    {
        return new Execution { Account = account, ExecutionId = id, OrderId = "O-" + id, Instrument = Es(), MarketPosition = side, Quantity = qty, Price = price, Commission = commission, Time = time };
    }

    private static Order Ord(Account account, string id, OrderAction action, OrderType type, OrderState state, int qty, int filled, double price)
    {
        return new Order { Account = account, Instrument = Es(), OrderId = id, Id = 1, OrderAction = action, OrderType = type, OrderState = state, Quantity = qty, Filled = filled, AverageFillPrice = price, LimitPrice = price, StopPrice = 0, Time = new DateTime(2025, 11, 3, 9, 30, 0), Name = "Entry", Oco = "", TimeInForce = TimeInForce.Day };
    }

    private static Position Pos(Account account, MarketPosition mp, int qty, double avg)
    {
        return new Position { Account = account, Instrument = Es(), MarketPosition = mp, Quantity = qty, AveragePrice = avg };
    }

    public static void Main()
    {
        Account apex = new Account("APEX-123456-01", Provider.NinjaTrader, "Apex \"Tradovate\"", 50600.5);
        Account sim = new Account("Sim101", Provider.Simulator, "Simulated Data Feed", 100000);
        Account.All.Add(apex);
        Account.All.Add(sim);
        // Already in the session when NinjaTrader starts (09:30 New York = 14:30 UTC in November).
        apex.Executions.Add(Fill(apex, "E1", MarketPosition.Long, 2, 6500, 4.1, new DateTime(2025, 11, 3, 9, 30, 0, 120)));
        sim.Executions.Add(Fill(sim, "S1", MarketPosition.Long, 1, 6500, 0, new DateTime(2025, 11, 3, 9, 31, 0)));
        // An order and a position already in the session: picked up on start.
        apex.Orders.Add(Ord(apex, "O-E1", OrderAction.Buy, OrderType.Limit, OrderState.Filled, 2, 2, 6500));
        apex.Positions.Add(Pos(apex, MarketPosition.Long, 2, 6500));
        // The local-sim account's order/position must be skipped, like its fills.
        sim.Orders.Add(Ord(sim, "O-S1", OrderAction.Buy, OrderType.Market, OrderState.Filled, 1, 1, 6500));

        TradeLoopSync addOn = new TradeLoopSync();
        addOn.SetStateForTest(State.SetDefaults);
        addOn.SetStateForTest(State.Active);
        Thread.Sleep(2600);

        // A live fill while running, plus a live order update and the position going flat.
        apex.RaiseExecution(Fill(apex, "E2", MarketPosition.Short, 2, 6505.25, 4.1, new DateTime(2025, 11, 3, 9, 40, 10)));
        apex.RaiseOrder(Ord(apex, "O-E2", OrderAction.Sell, OrderType.StopMarket, OrderState.Filled, 2, 2, 6505.25));
        apex.RaisePosition(Pos(apex, MarketPosition.Flat, 0, 0));
        Thread.Sleep(3600);

        // Another prop account connects later (its session comes along).
        Account tpt = new Account("TPT-9", Provider.Tradovate, "Take Profit", 25000);
        tpt.Executions.Add(Fill(tpt, "E3", MarketPosition.Long, 1, 6510, 0, new DateTime(2025, 11, 3, 10, 0, 0)));
        lock (Account.All) Account.All.Add(tpt);
        Account.RaiseStatus(tpt, ConnectionStatus.Connected);
        Thread.Sleep(3600);

        addOn.SetStateForTest(State.Terminated);
        Console.WriteLine("harness done");
    }
}
