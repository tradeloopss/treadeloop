// The TradeLoop Help Center content. Authored as structured data (not raw
// markdown) so it renders consistently and stays easy to edit. Add an article
// by dropping it into the right category's `articles` array; add a category by
// adding to HELP. Icons are lucide names resolved in components/help/icon.ts.

import { appHref } from "@/lib/urls"
import type { FigureKey } from "@/components/help/help-figures"
import { EDGE_LAB_HELP } from "./edge-lab"

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "sub"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "note"; text: string }
  | { t: "warn"; text: string }
  | { t: "video"; url: string; title?: string }
  | { t: "link"; label: string; href: string; prefix?: string }
  // A guide "screenshot" of the real flow, drawn as a theme-aware mockup
  // (components/help/help-figures). `art` picks which step it shows.
  | { t: "figure"; art: FigureKey; caption?: string }

// The onboarding video — the Vimeo walkthrough, auto-embedded. Override with
// another YouTube/Vimeo link or the local /TradeLoop.mp4 via
// NEXT_PUBLIC_HELP_VIDEO_URL.
const INTRO_VIDEO = process.env.NEXT_PUBLIC_HELP_VIDEO_URL ?? "https://vimeo.com/1231022242"

export type Article = {
  slug: string
  title: string
  summary: string
  author?: string
  date?: string // ISO
  body: Block[]
}

export type Category = {
  slug: string
  title: string
  description: string
  icon: string
  articles: Article[]
}

export const HELP: Category[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Set up your account and get your first trades flowing.",
    icon: "rocket",
    articles: [
      {
        slug: "welcome-to-tradeloop",
        title: "Welcome to TradeLoop",
        summary: "TradeLoop: your comprehensive trading performance tracker.",
        author: "TradeLoop Team",
        date: "2026-09-28",
        body: [
          { t: "p", text: "TradeLoop is designed for traders looking to track and analyze their trading performance for continuous improvement. Here's an overview of what TradeLoop offers:" },
          { t: "h", text: "TradeLoop Onboarding Overview" },
          { t: "p", text: "Watch our onboarding video to get started:" },
          { t: "video", url: INTRO_VIDEO, title: "TradeLoop onboarding" },
          { t: "h", text: "✅ Importing your trades into TradeLoop" },
          { t: "p", text: "Effortlessly import your trades using one of three methods: File Upload (CSV), Broker Sync (MetaTrader 4/5, Rithmic, Tradovate), or Manual entry." },
          { t: "link", prefix: "Step-by-step guide", label: "Connecting accounts", href: "/help/connecting-accounts" },
          { t: "h", text: "📈 Trade tracking" },
          { t: "sub", text: "Easily and accurately track your trades" },
          { t: "p", text: "Get in-depth analytics of each trade — from entries and exits to risk management, setups and more." },
          { t: "link", prefix: "Direct link", label: "Trades", href: appHref("/trades") },
          { t: "h", text: "📓 Journaling" },
          { t: "sub", text: "Personalized journal and note-taking" },
          { t: "p", text: "Powerful journaling that lets you take notes, tag trades, and understand how you're performing overall." },
          { t: "link", prefix: "Direct link", label: "Daily Journal", href: appHref("/journal") },
          { t: "h", text: "📊 Reporting" },
          { t: "sub", text: "Drilled-down reporting" },
          { t: "p", text: "Access reports that help you gauge your strengths and weaknesses — discover what's working and what's not, and bring it into your trading plan." },
          { t: "link", prefix: "Direct link", label: "Reports", href: appHref("/reports") },
          { t: "h", text: "📘 Playbooks" },
          { t: "sub", text: "Build and refine your strategies" },
          { t: "p", text: "Capture each strategy as a playbook and measure exactly how it performs so you can double down on your edge." },
          { t: "link", prefix: "Direct link", label: "Playbooks", href: appHref("/playbooks") },
          { t: "h", text: "🛡️ Prop-firm tracking" },
          { t: "p", text: "Track your prop-firm rules — profit target, daily loss, max drawdown and trading days — automatically as you trade, on both evaluation and funded accounts." },
          { t: "link", prefix: "Direct link", label: "Propfirm Tracker", href: appHref("/propfirm-max") },
          { t: "note", text: "If you have any further questions or need assistance with anything regarding TradeLoop, please don't hesitate to contact our support team." },
        ],
      },
      {
        slug: "create-account",
        title: "Create your account",
        summary: "Sign up, verify your email, and land on your dashboard.",
        body: [
          { t: "steps", items: [
            "Go to the sign-up page and enter your email, a username and a password (or continue with Google).",
            "Check your inbox for the 6-digit verification code and enter it to confirm your email.",
            "You'll land on your dashboard. If you have no trading account yet, a window prompts you to connect your first one.",
          ] },
          { t: "p", text: "New accounts start on a free trial. You can pick a plan any time from Settings → Subscription." },
        ],
      },
      {
        slug: "connect-first-account",
        title: "Connect your first trading account",
        summary: "Link a broker so your trades import automatically.",
        body: [
          { t: "p", text: "Open Accounts (from the sidebar) and choose your platform. TradeLoop asks whether it's futures or forex first, then shows the right connect flow." },
          { t: "list", items: [
            "MetaTrader 4 / 5 — use your read-only investor password.",
            "Rithmic — for futures (Apex, Tradeify, and other Rithmic prop firms).",
            "Tradovate — connected through NinjaTrader.",
            "CSV — import a file if your broker isn't supported yet.",
          ] },
          { t: "p", text: "Each platform has its own guide in the “Connecting accounts” section." },
        ],
      },
    ],
  },
  {
    slug: "connecting-accounts",
    title: "Connecting accounts",
    description: "Link MetaTrader, Rithmic, Tradovate, or import a CSV.",
    icon: "plug",
    articles: [
      {
        slug: "metatrader",
        title: "Connect MetaTrader 4 or 5",
        summary: "Link an MT4/MT5 account with your investor (read-only) password.",
        body: [
          { t: "warn", text: "Use only the investor (read-only) password. Ask your prop firm before linking any account — some restrict third-party connections. TradeLoop is never responsible for a prop-firm issue caused by connecting your real (master/trading) password. Never enter your master password to connect." },
          { t: "link", prefix: "FundingPips account? It can't be connected directly", label: "Use TradeLoop with a FundingPips account", href: "/help/connecting-accounts/fundingpips" },
          { t: "p", text: "From Accounts → Add account, choose your platform. MetaTrader 5 and MetaTrader 4 each have their own tile." },
          { t: "figure", art: "platform-picker", caption: "Accounts → Add account → choose MetaTrader 5 (or MT4), then Continue." },
          { t: "steps", items: [
            "In MetaTrader, open File → Login to Trade Account to see your exact server name (e.g. Exness-Real6, FTMO-Server3, JustMarkets-Live).",
            "In TradeLoop: Accounts → Add account → MetaTrader 5 (or MT4).",
            "Enter the server name exactly as shown, your account number, and your investor password.",
            "Choose how much history to import, then Connect. The first login can take up to a minute.",
          ] },
          { t: "figure", art: "metatrader-form", caption: "Server name, account number and the investor (read-only) password — then Connect." },
          { t: "note", text: "If your broker's server isn't recognised, double-check the spelling. If it's right, we've been notified and will add it — most brokers are added within a day." },
          { t: "p", text: "The investor password can see your trades but can never place or close one. It's stored encrypted and used only by our sync server." },
        ],
      },
      {
        slug: "fundingpips",
        title: "Use TradeLoop with a FundingPips account",
        summary: "TradeLoop never connects to a FundingPips account. Here is the safe way to copy its trades to your other accounts.",
        author: "TradeLoop Team",
        date: "2026-10-07",
        body: [
          { t: "warn", text: "TradeLoop does not connect to FundingPips accounts and never asks for a FundingPips password. FundingPips does not allow a trading account to be opened from a server, even with the read-only investor password, and TradeLoop syncs from one. If you enter a FundingPips server on the connect form, TradeLoop refuses it to protect your account." },
          { t: "h", text: "How it works" },
          { t: "p", text: "FundingPips has its own Trade Copier in your FundingPips dashboard. It copies your FundingPips account's trades to your other FundingPips accounts, and to accounts you hold with other brokers. TradeLoop takes over from one of those outside accounts: you connect it to TradeLoop and copy from it to the rest of your accounts." },
          { t: "p", text: "Your FundingPips account stays the source of every trade. TradeLoop only ever sees the outside account." },
          { t: "h", text: "Set it up" },
          { t: "steps", items: [
            "Open a MetaTrader 5 account with a broker TradeLoop can connect, for example Exness or JustMarkets. This is your relay account.",
            "In your FundingPips dashboard, open Trade Copier and create a portfolio: your FundingPips account as the Lead, the relay account as a Follower.",
            "Still in FundingPips, map each symbol you trade to the relay broker's name for it, and choose the lot sizing.",
            "In TradeLoop, open Copy Trading → Connection → Connect Account and choose FundingPips account. It walks you through connecting the relay account with its investor (read-only) password. (Accounts → Add account → MetaTrader 5 does the same.)",
            "Create a copy group with the relay account as the Leader and your other accounts as followers.",
          ] },
          { t: "link", prefix: "FundingPips' own guide", label: "Trade Copier", href: "https://help.fundingpips.com/hc/en-us/articles/49580068780817-Trade-Copier" },
          { t: "note", text: "Copy Trading is being released in stages. If it shows “Coming soon” in your menu, it hasn't been opened to your account yet." },
          { t: "h", text: "Check before you rely on it" },
          { t: "list", items: [
            "Place one small trade on the FundingPips account first, and watch it arrive on the relay account and then on your followers.",
            "FundingPips' copier skips a trade, without any message, when a symbol has no mapping. A trade it skips never reaches the relay account, so TradeLoop cannot copy it. Check the mapping after every change.",
            "Two copiers run one after the other, so a copy arrives later than with a direct connection.",
            "FundingPips' copier is in beta and connects at most 4 accounts per user.",
          ] },
          { t: "h", text: "FundingPips rules that stay yours to keep" },
          { t: "list", items: [
            "Your FundingPips account is always the source. Never copy trades into a FundingPips account from anywhere else, the relay account included.",
            "Copy only to your own accounts. FundingPips prohibits coordinated trading between accounts owned by different people.",
            "Keep every account trading in the same direction as the FundingPips account. FundingPips prohibits taking opposite positions across accounts.",
            "To copy between two of your own FundingPips accounts, use FundingPips' Trade Copier. TradeLoop cannot do that part.",
          ] },
          { t: "link", prefix: "FundingPips' rules", label: "Trading Conduct and Security Standards", href: "https://help.fundingpips.com/hc/en-us/articles/34505029138449-Trading-Conduct-and-Security-Standards" },
          { t: "h", text: "Journal your FundingPips trades" },
          { t: "p", text: "The relay account's trades sync to your journal like any other account. To journal the FundingPips account itself, import its history as a file: Accounts → Add account → File / CSV." },
          { t: "note", text: "This guide follows FundingPips' published rules as of 7 October 2026. Their rules can change, and FundingPips decides how they apply to your account. Check their pages, or ask their support, before you rely on it." },
        ],
      },
      {
        slug: "rithmic",
        title: "Connect Rithmic (futures)",
        summary: "Link a Rithmic account for Apex, Tradeify and other futures prop firms.",
        body: [
          { t: "steps", items: [
            "Accounts → Add account → Rithmic.",
            "Pick your Rithmic system (your prop firm's gateway) and enter your Rithmic username and password.",
            "Connect. TradeLoop discovers your accounts and imports your fills.",
          ] },
          { t: "figure", art: "rithmic-form", caption: "Pick your prop firm's Rithmic system, enter your Rithmic login, then Connect." },
          { t: "note", text: "Rithmic limits how often an account can sign in. TradeLoop syncs on a sensible schedule and pauses automatically after repeated login failures so your prop firm doesn't flag the account — a manual “Sync now” always works and clears the pause." },
        ],
      },
      {
        slug: "csv-import",
        title: "Import trades from a CSV",
        summary: "Bring in history from any broker with a file.",
        body: [
          { t: "steps", items: [
            "Accounts → Add account → File / CSV.",
            "Upload your broker's export.",
            "Map the columns (symbol, side, quantity, entry/exit price and time) — save the layout as a CSV Schema in Settings so next time is one click.",
          ] },
          { t: "figure", art: "csv-map", caption: "Drop your export, then map each column to the right field before importing." },
          { t: "p", text: "Duplicate trades already in your journal are never imported twice." },
        ],
      },
    ],
  },
  {
    slug: "trades-journal",
    title: "Trades & journal",
    description: "How trades sync, and how to journal and organise them.",
    icon: "notebook",
    articles: [
      {
        slug: "how-sync-works",
        title: "How syncing and the daily journal work",
        summary: "Live connections check for new trades about every minute.",
        body: [
          { t: "list", items: [
            "Live connections (Rithmic/MT5/Tradovate) check for new trades roughly every minute.",
            "Your dashboard, calendar, equity curve and reports fill in from real trades — no manual entry.",
            "A journal entry is generated for each trading day; you can add your own notes and reflections.",
          ] },
          { t: "note", text: "Days are grouped by your time zone. The site defaults to Cairo time; visitors elsewhere are bucketed by their own location automatically. You can override this in Settings → Preferences." },
        ],
      },
      {
        slug: "tags-playbooks",
        title: "Tags, playbooks and templates",
        summary: "Organise trades by setup, emotion and mistake.",
        body: [
          { t: "p", text: "Create tag groups (setups, mistakes, emotions…) in Settings → Tags, then tag trades to slice your stats by them in Reports." },
          { t: "p", text: "Playbooks capture your strategies; Trade Templates (Settings → Trade Templates) pre-fill the Add-Trade form with an instrument, size, stop and target you use often." },
        ],
      },
    ],
  },
  {
    slug: "trades-manager",
    title: "Trades Manager",
    description: "Manage live positions — SL/TP, close, partial, reverse.",
    icon: "activity",
    articles: [
      {
        slug: "overview",
        title: "Manage your live positions",
        summary: "See every open position and act on it in a couple of taps.",
        body: [
          { t: "p", text: "Trade Manager (a Pro feature, in the Account Manager area of the menu) shows your live open positions with real-time P&L. Pick an account at the top to see just that account's positions and history." },
          { t: "list", items: [
            "Edit Stop Loss / Take Profit on any position.",
            "Close a position fully, or partial-close part of it.",
            "Move the stop to break-even, or reverse the position (flip the side).",
            "Select several positions and edit SL/TP or close them in bulk.",
          ] },
        ],
      },
      {
        slug: "enable-execution",
        title: "Enable live order execution",
        summary: "Why sending orders needs your master (trading) password.",
        body: [
          { t: "p", text: "Editing SL/TP or closing a position sends a real order to your broker. The investor password you connect with is read-only and physically cannot place or change an order — so the first time you act on a position, TradeLoop asks for that account's master (trading) password to enable execution." },
          { t: "warn", text: "Only enable execution if you're comfortable storing the master password (it's encrypted and used only for orders you request). On a funded account, every order is checked against your Propfirm Tracker rules first — a rule-breaking order is blocked before it reaches the broker." },
          { t: "steps", items: [
            "In Trades Manager, tap Edit SL (or Close) on a live position.",
            "Enter the account's master/trading password when prompted, and enable execution.",
            "Retry the action — it now sends to your broker and confirms within a few seconds.",
          ] },
        ],
      },
    ],
  },
  {
    slug: "propfirm",
    title: "Prop-firm tracking",
    description: "Track drawdown, daily loss and profit targets automatically.",
    icon: "shield",
    articles: [
      {
        slug: "tracker",
        title: "Track your prop-firm rules",
        summary: "Know exactly where you stand against your firm's limits.",
        body: [
          { t: "p", text: "The Propfirm Tracker (Pro) reads your synced trades and shows how you're doing against your firm's rules — profit target, daily loss limit, max drawdown and trading days — for both evaluation and funded accounts." },
          { t: "p", text: "Pick your firm and account type when you add a prop account; TradeLoop applies that firm's rule set as you trade." },
        ],
      },
    ],
  },
  EDGE_LAB_HELP,
  {
    slug: "billing",
    title: "Billing & plans",
    description: "Plans, the free trial, and managing your subscription.",
    icon: "card",
    articles: [
      {
        slug: "plans",
        title: "Plans and the free trial",
        summary: "What you get on each plan.",
        body: [
          { t: "list", items: [
            "Every new account starts with a free trial.",
            "Essential — the core journal for a few accounts, with live sync for one MetaTrader account.",
            "Pro — unlimited features: up to 40 active accounts, live sync from Rithmic/MetaTrader/TradingView, the full reports suite, Trades Manager and Propfirm Tracker.",
          ] },
        ],
      },
      {
        slug: "manage-subscription",
        title: "Manage your subscription",
        summary: "Change plan, update payment, view invoices.",
        body: [
          { t: "p", text: "Go to Settings → Subscription (or Billing) to change your plan, update your payment method, view invoices, or cancel. Changes take effect from your next billing period." },
        ],
      },
    ],
  },
  {
    slug: "faq",
    title: "FAQ",
    description: "Quick answers to common questions.",
    icon: "help",
    articles: [
      {
        slug: "common",
        title: "Frequently asked questions",
        summary: "Passwords, safety, missing trades and more.",
        body: [
          { t: "h", text: "Is it safe to connect my broker?" },
          { t: "p", text: "Yes. Syncing uses read-only credentials (the MetaTrader investor password) and only reads your history. Nothing is placed or changed unless you explicitly enable order execution for an account." },
          { t: "h", text: "My trades aren't showing up — why?" },
          { t: "p", text: "Give the first sync up to a minute. Check the account status in Accounts — if a connection shows an error, re-enter your credentials (server name must match MetaTrader exactly). Rithmic accounts pause after repeated login failures; hit “Sync now” to resume." },
          { t: "h", text: "Which password do I use?" },
          { t: "p", text: "For connecting/syncing: the investor (read-only) password. For sending orders from Trades Manager: the master (trading) password, which you opt into per account." },
          { t: "h", text: "Can I get help from a person?" },
          { t: "p", text: "Yes — open a support ticket from inside the app (Help & support in the sidebar menu) and our team will reply." },
        ],
      },
    ],
  },
]

export function findCategory(slug: string): Category | undefined {
  return HELP.find((c) => c.slug === slug)
}
export function findArticle(categorySlug: string, articleSlug: string): { category: Category; article: Article } | undefined {
  const category = findCategory(categorySlug)
  const article = category?.articles.find((a) => a.slug === articleSlug)
  return category && article ? { category, article } : undefined
}
