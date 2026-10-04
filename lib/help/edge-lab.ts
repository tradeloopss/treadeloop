import { appHref } from "@/lib/urls"
import type { Category } from "./content"

// The Help Center's guide to Edge Lab. It describes what the pages do today —
// when a page changes, change the paragraph that describes it.

export const EDGE_LAB_HELP: Category = {
  slug: "edge-lab",
  title: "Edge Lab",
  description: "Find what makes you profitable, test it, and keep watching it.",
  icon: "brain",
  articles: [
    {
      slug: "guide",
      title: "Edge Lab: every feature and how to use it",
      summary: "What each page does, what the numbers mean, and a first session to follow.",
      author: "TradeLoop Team",
      date: "2026-10-04",
      body: [
        { t: "note", text: "Edge Lab is being released in stages. If its pages show “Coming soon” in your menu, it hasn't been opened to your account yet — nothing is wrong with your account." },
        { t: "p", text: "Reports tell you what happened. Edge Lab answers a different question: what actually makes you profitable, and how sure can you be? It reads the trades you already have in TradeLoop, looks for the conditions you do best and worst in, lets you test an idea properly, and then watches whether it keeps working. Nothing is copied or re-entered — it works from your existing trades." },

        { t: "h", text: "Before you start" },
        { t: "list", items: [
          "You need 30 closed trades in the period you are looking at. With fewer, Edge Lab shows “Not enough data yet” and how far along you are, instead of guessing.",
          "A single pattern needs 20 trades before it gets a score, and a cell of the Edge Matrix needs 5 before it is shown at all.",
          "Set a stop loss on your trades. A trade with a stop has a result in R (what it made divided by what it risked), which is how Edge Lab compares trades of different sizes. Without stops it falls back to money.",
          "Tag your trades with a setup, or log them under a playbook. That is what the Setup and Strategy conditions are built from.",
          "The same trade copied to several accounts counts once, so a copied account can't make a pattern look bigger than it is.",
          "Backtest trades are left out unless you choose them in the Trades filter.",
        ] },

        { t: "h", text: "Finding your way around" },
        { t: "p", text: "Edge Lab is its own area in the main menu, with five entries:" },
        { t: "list", items: [
          "Edge Overview — your score, your strongest edge, your biggest leak and the Edge Matrix.",
          "Edge Discovery — two tabs: Discover (search for combinations) and Regimes (market conditions and MAE/MFE).",
          "Psychology — how your behaviour and state of mind change your results.",
          "Edge Journal — two tabs: Setups (a profile of each setup and strategy) and Monitor (the edges you are watching, alerts and your rules).",
          "Edge Tests — two tabs: Hypotheses (test an idea, compare two versions) and Robustness (Monte Carlo and walk-forward).",
        ] },
        { t: "link", prefix: "Direct link", label: "Edge Lab", href: appHref("/edge-lab") },

        { t: "h", text: "The filters" },
        { t: "p", text: "Every page starts with the same filters: a date range (7D, 30D, 90D, 6M, 1Y, All or Custom), then Account, Market, Strategy, Setup and Trades (live, backtests, or both). On a phone they sit behind the Filters button. Everything on the page is worked out from what the filters leave, and they stay with you as you move between pages. The filters are part of the page address, so you can bookmark a view." },

        { t: "h", text: "Edge Overview" },
        { t: "sub", text: "The five figures at the top" },
        { t: "list", items: [
          "Edge Score (0–100) — built from sample size, expectancy, profit factor, statistical confidence, month-to-month consistency, drawdown and how your most recent trades did. The bands are: 0–30 Weak, 31–50 Unproven, 51–70 Promising, 71–85 Strong, 86–100 Exceptional.",
          "Expectancy — what an average trade made, in R when your trades have stops.",
          "Profit factor — gross profit divided by gross loss. Above 1 means winners outweighed losers.",
          "Edge confidence — how sure the data is that your average trade is really above zero and not luck.",
          "Sample size — the number of closed trades behind everything on the page.",
        ] },
        { t: "p", text: "Under each figure, “vs previous period” compares it with the same length of time just before your date range." },
        { t: "note", text: "A high win rate is never enough to score well. The score is capped by sample size: at most 50 with fewer than 40 trades, 70 with fewer than 75, and 85 with fewer than 150. A pattern that loses money on average can't score above 30, and one whose most recent trades are losing can't score above 60. When a cap applies, the page says which." },
        { t: "sub", text: "Strongest edge and biggest leak" },
        { t: "p", text: "The strongest edge is the combination of conditions (for example a market, a session and a setup) that has made you money most reliably. The biggest leak is the combination that has cost you the most. Each card shows its expectancy, profit factor and the number of trades behind it." },
        { t: "list", items: [
          "Investigate — opens the full detail of that slice (see “The edge detail panel” below).",
          "Add to Playbook — creates a playbook from the edge, with its conditions as rules, and starts watching it. Needs 20 trades.",
          "Create rule — on a leak, adds “Avoid: …” to your rules. From then on, trades that break it are counted.",
        ] },
        { t: "sub", text: "Edge Matrix" },
        { t: "p", text: "A grid of any two conditions against each other — markets by session, setups by day, and so on. Choose what goes in the rows and the columns. Each cell is the average trade for that pairing, and says it three ways: the colour, an arrow, and the number, with the number of trades underneath. A cell marked “thin” has fewer than 20 trades — shown, but too few to rely on. Tap any cell to open it." },
        { t: "sub", text: "Discoveries" },
        { t: "p", text: "A short list of what stands out in your trades, each with the figures it rests on and how strongly it can be read: Observed (it happened), Correlated (two things went together), or Statistically supported (unlikely to be chance)." },

        { t: "h", text: "The edge detail panel" },
        { t: "p", text: "Anything you tap in Edge Lab — a card, a matrix cell, a search result — opens the same panel (a drawer on a computer, a sheet from the bottom on a phone). It shows:" },
        { t: "list", items: [
          "The score and “Why this score”: each of the seven parts, out of 100, with the reason.",
          "Expectancy next to “Every other trade”, so you can see whether the slice is really better than the rest.",
          "Profit factor, win rate, net result, average win and loss, largest drawdown, and profitable months.",
          "“Most recent 30% of trades” on their own — a quick check that it still works.",
          "The running total as a chart, and the spread of results in R.",
          "“Works best when” and “Works worst when”: the extra conditions that help and hurt this slice the most.",
          "The slice by session, by day and by holding time — and by how you felt, once you check in before trades.",
          "MAE and MFE, when price history has been analysed (see Regimes).",
        ] },
        { t: "p", text: "At the bottom: Add to Playbook (or Create rule on a losing slice), Watch (follow it in Edge Journal → Monitor), Test it (open it in Hypotheses) and Robustness." },

        { t: "h", text: "Edge Discovery" },
        { t: "sub", text: "Discover: search for combinations" },
        { t: "steps", items: [
          "Tick what you want combined — market, session, direction, day, setup, strategy, holding time, and more.",
          "Optionally narrow it with “Only within” (for example only one market).",
          "Choose how many conditions a combination may have (up to 4) and press Search.",
          "Read the two lists: Edges, ranked by score, and Leaks, ranked by what they cost. Tap one to open it.",
        ] },
        { t: "p", text: "Every combination is measured against your trades; one needs 20 trades to be listed. Below the search, “Where your result comes from” splits your total step by step — by market, then session, then direction, in the order you choose — so you can open a branch and see what is inside it." },
        { t: "sub", text: "Regimes: market conditions, MAE and MFE" },
        { t: "p", text: "Press “Analyse price history”. TradeLoop then reads price history for the markets you trade and works out, for each trade, what its market was doing the day before: trending up, trending down or ranging; high, normal or low volatility; range expanding or compressing. Your results are then shown for each. It also measures how far each trade went against you (MAE) and in your favour (MFE) before it closed." },
        { t: "list", items: [
          "It runs when you press the button, a batch at a time. If it says trades are left, press it again.",
          "Prices come from a free public feed. A market it doesn't carry, or a trade older than its history, is left without a figure rather than guessed.",
          "MAE and MFE need a stop loss on the trade, because they are measured in R.",
        ] },

        { t: "h", text: "Edge Journal" },
        { t: "sub", text: "Setups" },
        { t: "p", text: "A profile of each setup tag and each playbook: its score, expectancy, profit factor, win rate and net result, with “Works best when” and “Works worst when” underneath. A setup needs 5 trades to appear and 20 before its best and worst conditions are shown." },
        { t: "sub", text: "Monitor" },
        { t: "p", text: "The edges you chose to watch. Each compares its latest 50 matching trades with everything before them and gives a status: Healthy, Stable, Weakening, Degraded, or Insufficient data. You can be told in the app, by email, or both when a status changes. Monitor always uses your whole history — the date filter doesn't apply here." },
        { t: "note", text: "Watched edges are checked when you open Edge Lab, so an alert appears the next time you visit after the change." },
        { t: "p", text: "Monitor also holds your rules: the ones made from a leak or a behaviour pattern, and any you write yourself. A rule made from a leak counts how many trades have broken it since, and what they cost. Rules don't block anything — they are yours to keep." },

        { t: "h", text: "Edge Tests" },
        { t: "sub", text: "Hypotheses" },
        { t: "steps", items: [
          "Build the idea as conditions: IF Session is London AND Setup is Breakout.",
          "Press “Test hypothesis”. The matching trades are compared with every other trade in the period.",
          "Read the verdict — Supported, Not supported or Inconclusive — with the evidence for, the evidence against, and what else could explain it.",
          "Save it, and test it again as new trades come in.",
        ] },
        { t: "p", text: "A hypothesis is only Supported when the matching trades did better than the rest, the difference is at least 95% likely to be real, there are 30 or more of them, they made money, and the most recent 30% didn't lose. Anything less is Inconclusive rather than a yes." },
        { t: "list", items: [
          "Add to Playbook — available once a hypothesis is supported.",
          "Forward test — starts watching it, so new matching trades are tracked in Monitor.",
          "Run backtest — opens Backtesting.",
          "Compare two variations — put version A against version B. It compares the trades you actually took; it can't replay a trade with a different stop or target.",
        ] },
        { t: "sub", text: "Robustness" },
        { t: "p", text: "Two checks that an edge isn't luck. Leave “What to test” empty to test all your trades in the period, or narrow it to one edge." },
        { t: "list", items: [
          "Monte Carlo simulation — your own results drawn at random into 1,000 to 50,000 possible sequences. It shows the median outcome, a bad run (5th percentile), a good run, how many runs lost money, typical and deep drawdowns, losing streaks, and the risk of ruin for a level you set.",
          "Walk-forward — your trades in order: the first 60% is where the edge was found, the next 20% checks it, and the last 20% is the test it never saw. The verdict is Holds up, Weaker out of sample, or Did not hold, with a robustness percentage.",
        ] },
        { t: "warn", text: "A simulation re-orders your past results; it is not a prediction. Historical performance does not guarantee future results." },

        { t: "h", text: "Psychology" },
        { t: "p", text: "Psychology connects how you behave and feel with what your trades made. It is measured from your trade log and from what you tell it — and everything you tell it is optional." },
        { t: "list", items: [
          "Pre-trade check-in — about ten seconds: how you feel, why this trade, whether it is in your plan, and confidence, focus and stress from 1 to 10. It attaches to the next trade you open, and you can always skip it.",
          "Post-trade review — did you follow the plan, did anything interfere (moved stop, closed early…), how you felt afterwards. Trades from the last seven days wait under “Reviews waiting”.",
          "Morning check-in and end-of-day review — once a day each.",
          "Scores — Psychology, Emotional control, Discipline, Focus, Confidence and Stress. “How these scores are worked out” lists every part; a part with no data is left out, never filled in.",
          "Tilt risk today — today against your usual day: losses in a row, pace, risk size and rule breaks. When it is raised you can start a cool-down. A cool-down is a reminder only; nothing is locked.",
          "State of mind and results — how the average trade did in each state you reported.",
          "Patterns — tests run on your trade log: revenge trading, trading after losses, overtrading, risk changes after wins and losses, early exits, and more. Each says what was counted and what it cost, and lists what can't be measured yet.",
          "Triggers — the states that go with your worst trades, and what tends to come with them.",
          "Review — this week against last week, the last 60 days day by day, and your trading profile.",
          "Coach — each note keeps what was Observed apart from the Correlation, the Hypothesis and the Recommendation, so you can see what is fact and what is interpretation.",
          "Challenges — seven-day challenges checked against your trades, such as no trade within 10 minutes of a loss.",
        ] },
        { t: "note", text: "Behavioral insights describe observed trading patterns and are not medical or psychological diagnoses." },
        { t: "link", prefix: "Direct link", label: "Psychology", href: appHref("/psychology") },

        { t: "h", text: "A good first session" },
        { t: "steps", items: [
          "Open Edge Overview with the date range on All, and read your Edge Score and what limits it.",
          "Tap “Investigate edge” on your strongest edge. Check “Most recent 30% of trades” and “Works worst when”.",
          "Press “Test it” to run it as a hypothesis. If it comes back Supported, add it to a playbook; if Inconclusive, press Watch and let more trades come in.",
          "Go back and open your biggest leak. If it is something you can avoid, press “Create rule”.",
          "Open Edge Tests → Robustness and run the simulation on your edge to see the drawdown you should expect from it.",
          "From now on, check in before your trades. After a few weeks the Psychology pages and the “by how you felt” breakdowns fill in.",
        ] },

        { t: "h", text: "Reading the numbers" },
        { t: "list", items: [
          "R — a trade's result divided by what it risked. +2R made twice the risk; −1R lost it.",
          "Expectancy — the average result per trade.",
          "Profit factor — gross profit divided by gross loss.",
          "Confidence — how likely it is that a result is real and not chance, given the number of trades and how much they vary.",
          "n = 42 — the number of trades behind a figure. It is shown next to every figure; the smaller it is, the less the figure means.",
          "MAE / MFE — the furthest a trade went against you, and in your favour, before it closed.",
        ] },
        { t: "note", text: "Edge Lab's insights are based on your recorded trading data and should be treated as analysis, not financial advice. Historical performance does not guarantee future results." },
      ],
    },
  ],
}
