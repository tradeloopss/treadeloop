'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import './home.css'
import { ArrowRight, BarChart3, Bot, CalendarDays, Check, ChevronDown, CircleDollarSign, GraduationCap, Menu, Pause, PlayCircle, RotateCcw, SkipBack, SlidersHorizontal, Sparkles, TrendingUp, Users, X } from 'lucide-react'

const navProducts = [
  { label: 'Automated Journal', icon: CalendarDays, description: 'Auto-sync and log every trade to analyze performance.', status: 'live' as const, preview: 'journal' as const },
  { label: 'Backtesting', icon: BarChart3, description: 'Validate your strategy against historical market data.', status: 'soon' as const },
  { label: 'TradeLoop AI', icon: Bot, description: 'Your AI trading partner that reviews every session.', status: 'soon' as const },
  { label: 'Prop Firm Sync', icon: CircleDollarSign, description: 'One dashboard to track finances and every prop firm account.', status: 'live' as const, preview: 'propfirm' as const },
]
const navMore = [
  { label: 'Trade Replay', icon: RotateCcw, description: "Replay any trade you've taken tick-by-tick." },
  { label: 'TradeLoop Academy', icon: GraduationCap, description: 'Structured courses and actionable playbooks.' },
  { label: 'Spaces', icon: Users, description: 'Share your journal with mentors and trading groups.' },
]

function ProductPreview({ kind }: { kind: 'journal' | 'propfirm' }) {
  if (kind === 'journal') {
    return <div className="mini-preview">
      <div className="mini-stat-row"><div><small>Net P&amp;L</small><b className="green">$2,300.90</b></div><div><small>Trades</small><b>4</b></div><div><small>Win rate</small><b>75%</b></div></div>
      <svg viewBox="0 0 260 60" role="img" aria-label="Sample equity curve"><path d="M0 46 C30 44 40 40 60 41 S90 30 110 33 S140 20 160 24 S190 12 210 15 S240 5 260 8" fill="none" stroke="#7b68ee" strokeWidth="3" strokeLinecap="round"/></svg>
    </div>
  }
  return <div className="mini-preview">
    <div className="mini-stat-row"><div><small>Net total</small><b className="green">+$7,358</b></div><div><small>Total spent</small><b>$1,342</b></div><div><small>ROI</small><b className="green">548%</b></div></div>
    <div className="mini-firm-row"><span className="mini-firm-dot" />5 prop accounts tracked</div>
  </div>
}

// The Backtesting panel's own visual: replay toolbar, equity curve, result
// strip and a floating strategy comparison — an illustration of the product,
// like the hero mockup, not a screenshot of shipped software.
function BacktestingPreview() {
  const curve = 'M0 150 L26 150 L38 132 L52 96 L96 94 L108 92 L150 90 L162 62 L204 60 L216 30 L232 12 L300 10 L318 14 L330 8 L360 12'
  return <div className="bt-preview">
    <div className="bt-toolbar">
      <span className="bt-speed">1.5x <i className="bt-track"><b /></i></span>
      <span className="bt-controls"><SkipBack size={15}/><PlayCircle size={19} className="bt-play"/><SkipBack size={15} className="bt-flip"/></span>
      <span className="bt-tf">1min <ChevronDown size={13}/></span>
    </div>

    <div className="bt-chart-card">
      <p className="bt-chart-title">Backtesting — Opening Drive Strategy</p>
      <div className="bt-chart">
        <div className="bt-axis"><span>$72,000</span><span>$48,000</span><span>$24,000</span><span>$0</span></div>
        <svg viewBox="0 0 360 170" preserveAspectRatio="none" role="img" aria-label="Sample backtest equity curve">
          <defs><linearGradient id="btFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34c98a" stopOpacity=".45"/><stop offset="100%" stopColor="#34c98a" stopOpacity="0"/></linearGradient></defs>
          <path d={`${curve} L360 170 L0 170 Z`} fill="url(#btFill)"/>
          <path d={curve} fill="none" stroke="#25b378" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="bt-dates"><span>01/02/24</span><span>04/25/24</span><span>10/17/24</span><span>04/01/25</span></div>
    </div>

    <div className="bt-stats">
      <div className="bt-split">
        <div className="bt-split-bar"><i style={{width:'49%'}}/><em style={{width:'51%'}}/></div>
        <div className="bt-split-labels"><span>Long<b>35</b></span><span>Short<b>37</b></span></div>
      </div>
      <div className="bt-metric"><small>Trade win %</small><strong>57.50%</strong></div>
      <div className="bt-metric"><small>Profit factor</small><strong>1.84</strong></div>
    </div>

    <div className="bt-compare">
      <small>STRATEGY COMPARISON</small>
      {[['ICT Model', 34], ['Break and Retest', 66], ['Opening Drive', 81]].map(([name, pct]) => (
        <div key={name as string} className="bt-compare-row">
          <span>{name}</span>
          <i><b style={{width:`${pct}%`}}/></i>
          <em>{pct}%</em>
        </div>
      ))}
    </div>
  </div>
}


// Trade Replay panel visual: a replayed session with the trade's zone marked,
// entry/exit arrows, the mistakes tagger and a scrub timeline. An illustration
// of the product, like the hero mockup — not a screenshot of shipped software.
function TradeReplayPreview() {
  // [open, high, low, close] in chart units; the tail is dimmed to read as
  // "bars the replay hasn't reached yet".
  const candles: [number, number, number, number][] = [
    [62, 70, 58, 66], [66, 74, 62, 60], [60, 66, 52, 56], [56, 60, 30, 34],
    [34, 40, 24, 28], [28, 46, 26, 42], [42, 48, 36, 40], [40, 58, 38, 54],
    [54, 60, 48, 50], [50, 56, 46, 52], [52, 78, 50, 74], [74, 96, 70, 92],
    [92, 98, 84, 88], [88, 92, 80, 84], [84, 88, 76, 80], [80, 86, 74, 78],
    [78, 90, 74, 86], [86, 104, 82, 100], [100, 112, 96, 108], [108, 120, 104, 116],
    [116, 124, 110, 120], [120, 134, 116, 130], [130, 140, 126, 136],
  ]
  const live = 12 // bars before this are "played", the rest are dimmed
  const w = 14
  const y = (v: number) => 210 - v * 1.35

  return <div className="tr-preview">
    <svg viewBox="0 0 340 230" role="img" aria-label="Sample trade replay">
      {/* The trade's zone: target above the entry, stop below it. */}
      <rect x={52} y={y(96)} width={132} height={y(46) - y(96)} fill="#3fbf88" opacity=".16" />
      <rect x={52} y={y(46)} width={132} height={y(30) - y(46)} fill="#ef6a6a" opacity=".16" />

      {candles.map(([o, h, l, c], i) => {
        const x = 8 + i * w
        const up = c >= o
        const dim = i >= live + 6
        const color = dim ? "#c9c4d4" : up ? "#2fae72" : "#e0574f"
        return <g key={i} opacity={dim ? 0.55 : 1}>
          <line x1={x + 4} x2={x + 4} y1={y(h)} y2={y(l)} stroke={color} strokeWidth="1.3" />
          <rect x={x} y={y(Math.max(o, c))} width={8} height={Math.max(2, Math.abs(y(o) - y(c)))} fill={color} />
        </g>
      })}

      {/* Entry (bottom-left) and exit (top-right) markers. */}
      <path d="M62 178 L74 166 L74 172 L84 172 L84 180 L74 180 L74 186 Z" fill="#2fae72" />
      <path d="M186 74 L174 62 L174 68 L162 68 L162 80 L174 80 L174 86 Z" fill="#d93a3a" />
    </svg>

    <div className="tr-mistakes">
      <span className="tr-grip">⠿</span>
      <span className="tr-mistakes-title">🏷 Mistakes</span>
      <span className="tr-dots">•••</span>
      <div className="tr-tags"><span>early exit ×</span><span>impulsive ×</span><i>▾</i></div>
    </div>

    <div className="tr-timeline">
      <i className="tr-track" />
      <span className="tr-mark tr-mark-start" />
      <span className="tr-mark tr-mark-entry" />
      <span className="tr-mark tr-mark-exit">2</span>
    </div>
  </div>
}


// AI Insights panel visual: three stacked agent cards through a trading day —
// a pre-market read, mid-session auto-tagging, and an end-of-day review. An
// illustration of the product, like the hero mockup.
function AiInsightsPreview() {
  return <div className="ai-preview">
    <div className="ai-card ai-card-back">
      <p className="ai-stamp"><i className="ai-dot ai-dot-purple" />SENTIMENT AGENT · 6:30 AM</p>
      <h4><Bot size={17} className="ai-face" />Here&apos;s what to watch based on your edge.</h4>
      <ul className="ai-list">
        <li><b>SPY.</b> Holds 5,892 gap — your ORB-15 setup fires here.</li>
        <li><b>Vol.</b> VIX 14.8 — range day, trim targets.</li>
        <li><b>Skip.</b> CPI 8:30 — you lose on news bars.</li>
      </ul>
    </div>

    <div className="ai-card ai-card-mid">
      <p className="ai-stamp"><i className="ai-dot ai-dot-amber" />AUTO-TAGGER · 11:24 AM</p>
      <h4>3 trades tagged with &lsquo;Early entry&rsquo;.</h4>
      <div className="ai-tag-row">
        <span className="ai-tag-head">SPY · −$420 · 09:32 AM</span>
        <span className="ai-chip">−3 MIN EARLY</span><span className="ai-chip ai-chip-amber">EARLY ENTRY</span>
      </div>
      <div className="ai-tag-row">
        <span className="ai-tag-head">ES · −$280 · 10:14 AM</span>
        <span className="ai-chip">HELD 16M</span><span className="ai-chip ai-chip-amber">EARLY ENTRY</span>
      </div>
    </div>

    <div className="ai-card ai-card-front">
      <p className="ai-stamp"><i className="ai-dot ai-dot-red" />SESSION REVIEW · 4:15 PM</p>
      <h4><Bot size={17} className="ai-face" />You&apos;re on tilt. Losses up 2.37x</h4>
      <p className="ai-alert"><span>ALERT</span> What I noticed: you size up after 1 winner.</p>
      <ul className="ai-actions">
        <li><Check size={11} />Set your daily loss limit to $200 (down from $280).</li>
        <li><Check size={11} />Locking you out after 3 trades.</li>
        <li><Check size={11} />Capped your size to 1 contract.</li>
      </ul>
      <span className="ai-cta">Update my rules →</span>
    </div>
  </div>
}


// Spaces panel visual: a community card over a shared feed with a day review
// and reactions. An illustration of the product, like the hero mockup.
function SpacesPreview() {
  return <div className="sp-preview">
    <div className="sp-community">
      <span className="sp-avatar sp-avatar-lg"><Users size={18} /></span>
      <p className="sp-community-name">MORNING BELL CREW</p>
      <div className="sp-community-meta"><span>3.2K Members</span><span>11,038 Posts</span><span>Private</span></div>
      <span className="sp-join">Join the community</span>
    </div>

    <div className="sp-feed">
      <div className="sp-post sp-post-pinned">
        <div className="sp-post-head">
          <b>Jasmine</b><span className="sp-admin">ADMIN</span>
          <span className="sp-time">2s ago<i /></span>
        </div>
        <p>Market Update April 27th — hey guys, this week is FOMC. The Fed&apos;s decision lands Wednesday, followed by the presser at 2:30.</p>
        <span className="sp-chip">Thoughts</span>
      </div>

      <div className="sp-post">
        <div className="sp-post-head">
          <span className="sp-avatar"><Users size={13} /></span>
          <b>Jay</b>
          <span className="sp-time">1d<i /></span>
        </div>
        <p className="sp-post-title">Day Review — May 4th, 2026</p>
        <p>Beautiful price action today. Focus was on $AMD (main trade), $CRWV, $NBIS and $ORCL.</p>
        <p className="sp-fade">$CRWV and $NBIS — my primary watches, both ripped 7–8% in the first five minutes, killing the R/R immediately. No real pullback, just straight initiative buying.</p>
        <div className="sp-daycard">
          <div><b>Mon, May 04, 2026</b><small>2 trades · 100% win</small></div>
          <span className="sp-daycard-pnl">$22,450</span>
        </div>
        <div className="sp-reactions">
          <span>👍 4</span><span>❤️ 1</span><span>🔥 1</span><span>☺</span><span>⟲</span><span>💬 1</span>
        </div>
      </div>
    </div>
  </div>
}


// Prop Firm Sync panel visual: balance-over-time with the firm's rule lines,
// a per-firm pass-rate card and the cost breakdown. An illustration of the
// product, like the hero mockup.
function PropFirmSyncPreview() {
  const area = 'M0 96 L38 92 L76 74 L114 70 L152 62 L190 58 L228 50 L266 54 L304 34 L330 22'
  const firms: [string, string, number, string][] = [
    ['Topstep', 'PASSED 3 OUT OF 18 ACCOUNTS', 20, '#e0574f'],
    ['Apex', 'PASSED 3 OUT OF 4 ACCOUNTS', 75, '#2fae72'],
    ['Tradeify', 'PASSED 6 OUT OF 12 ACCOUNTS', 50, '#e0952f'],
    ['MFF', 'PASSED 6 OUT OF 8 ACCOUNTS', 75, '#2fae72'],
  ]

  return <div className="pf-preview">
    <div className="pf-main">
      <div className="pf-main-head">
        <b>Account balance over time</b>
        <span className="pf-dates"><i>+ Start date</i><i>+ End date</i></span>
      </div>
      <div className="pf-legend">
        <span><i className="pf-dot" style={{background:'#7b68ee'}} />Account Balance</span>
        <span><i className="pf-dot" style={{background:'#e0574f'}} />Maximum Loss Limit</span>
        <span><i className="pf-dot" style={{background:'#2fae72'}} />Profit Target</span>
        <span>Best day</span><span>Worst day</span>
      </div>
      <p className="pf-axis-top">$58K</p>
      <svg viewBox="0 0 330 110" preserveAspectRatio="none" role="img" aria-label="Sample prop firm balance curve">
        <defs><linearGradient id="pfFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7b68ee" stopOpacity=".55"/><stop offset="100%" stopColor="#7b68ee" stopOpacity=".08"/></linearGradient></defs>
        <path d={`${area} L330 110 L0 110 Z`} fill="url(#pfFill)" />
        <path d={area} fill="none" stroke="#6b52dd" strokeWidth="2" />
        <line x1="0" x2="330" y1="30" y2="30" stroke="#2fae72" strokeWidth="1.4" strokeDasharray="6 5" />
        <line x1="0" x2="330" y1="72" y2="72" stroke="#e0574f" strokeWidth="1.4" strokeDasharray="6 5" />
        <circle cx="266" cy="54" r="4" fill="#e0574f" />
        <circle cx="330" cy="22" r="4" fill="#2fae72" />
      </svg>
      <p className="pf-axis-bottom">$43K</p>
      <div className="pf-xaxis"><span>Feb 26</span><span>Feb 27</span><span>Feb 28</span><span>Mar 1</span><span>Mar 2</span><span>Mar 3</span></div>
    </div>

    <div className="pf-firms">
      {firms.map(([name, sub, pct, color]) => (
        <div key={name} className="pf-firm-row">
          <div><b>{name}</b><small>{sub}</small></div>
          <div className="pf-firm-rate">
            <span style={{color}}>{pct}%</span>
            <i><b style={{width:`${pct}%`, background:color}} /></i>
          </div>
        </div>
      ))}
    </div>

    <div className="pf-finance">
      <p className="pf-finance-title">Finance breakdown</p>
      <div className="pf-tabs"><span>Firms</span><span>Challenge type</span><span>Challenge size</span><span className="pf-tab-active">Expenses</span></div>
      {[['Evaluation fees', 842], ['Reset fees', 285], ['Activation fees', 215]].map(([label, amount]) => (
        <div key={label as string} className="pf-fee-row">
          <div><b>{label}</b><small>Total spent: ${amount}</small></div>
          <span>-${amount}</span>
        </div>
      ))}
    </div>
  </div>
}

const products = [
  { label: 'Automated Journal', icon: CalendarDays, eyebrow: 'AUTOMATED JOURNAL', title: 'Every fill, journaled automatically.', description: 'Connect once. Trades flow in real-time from 500+ brokers — auto-tagged and ready to review. Never log a trade by hand again.', bullets: ['500+ brokers & prop firms', 'Real-time sync, no refresh', 'Auto-tagging & setup detection'] },
  { label: 'Backtesting', icon: BarChart3, soon: true, eyebrow: 'BACKTESTING', title: 'Prove your edge before risking a dollar.', description: 'Test your strategy against years of tick data. See the win rate, profit factor, and max drawdown before live capital is on the line.', bullets: ['Tick-level historical data', 'Bar-by-bar replay', 'Multi-strategy comparison', 'Playbook library'] },
  { label: 'Trade Replay', icon: RotateCcw, soon: true, eyebrow: 'TRADE REPLAY', title: 'Practice the market that already happened.', description: 'Build pattern recognition with realistic market replay. Pause, rewind, and make decisions without risking capital.', bullets: ['Replay any trading session', 'Practice entries and exits', 'Track your progress'] },
  { label: 'AI Insights', icon: Bot, soon: true, eyebrow: 'AI INSIGHTS', title: 'Your trading coach, always on.', description: 'TradeLoop AI finds the patterns hiding in your data and gives you clear, personalized next steps.', bullets: ['Personalized trade reviews', 'Spot strengths and leaks', 'Ask questions about your data'] },
  { label: 'Spaces', icon: Users, soon: true, eyebrow: 'SPACES', title: 'Trade better, together.', description: 'Share playbooks, trade ideas, and progress with a community that gets it.', bullets: ['Private trading groups', 'Share strategies and notes', 'Learn from verified traders'] },
  { label: 'Prop Firm Sync', icon: CircleDollarSign, eyebrow: 'PROP FIRM SYNC', title: 'One view for every account.', description: 'Keep your prop firm challenges and personal accounts organized in one powerful workspace.', bullets: ['Sync popular prop firms', 'Monitor account rules', 'See every account at a glance'] },
]

function Logo() {
  return <div className="logo" aria-label="Tradeloop home"><span>TRADE<span className="logo-accent">LOOP</span></span></div>
}

function DashboardMockup() {
  return <div className="dashboard-wrap" aria-label="Trading dashboard preview">
    <div className="dashboard-card">
      <aside className="dash-side"><div className="dash-mini-logo"><span className="logo-mark small"><span /></span></div><div className="dash-nav active">▦ <span>Dashboard</span></div><div className="dash-nav">◷ <span>Day View</span></div><div className="dash-nav">↗ <span>Trade View</span></div><div className="dash-nav">▤ <span>Notebook</span></div><div className="dash-nav">◒ <span>Reports</span></div><div className="dash-nav">◫ <span>Trade Replay</span></div></aside>
      <div className="dash-main"><div className="dash-top"><strong>Dashboard</strong><span className="dash-date">June 2024⌄</span></div><div className="metric-row"><div><small>Net P&L</small><b className="green">$107,183.75</b></div><div><small>Win rate</small><b>68.4%</b></div><div><small>Trades</small><b>1,248</b></div></div><div className="chart-box"><div className="chart-label">Performance <span>This month ▾</span></div><svg viewBox="0 0 540 180" role="img" aria-label="Rising performance chart"><path d="M0 150 C45 142 56 125 88 132 S125 100 158 112 S205 78 230 94 S275 62 310 71 S350 55 380 62 S410 36 448 45 S495 15 540 20" fill="none" stroke="#7b68ee" strokeWidth="4" strokeLinecap="round"/><path d="M0 150 C45 142 56 125 88 132 S125 100 158 112 S205 78 230 94 S275 62 310 71 S350 55 380 62 S410 36 448 45 S495 15 540 20 V180 H0Z" fill="url(#fade)"/><defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#8b74ef" stopOpacity=".18"/><stop offset="1" stopColor="#8b74ef" stopOpacity="0"/></linearGradient></defs></svg></div><div className="calendar-grid"><div className="cal-head">SUN</div><div className="cal-head">MON</div><div className="cal-head">TUE</div><div className="cal-head">WED</div><div className="cal-head">THU</div><div className="cal-head">FRI</div>{['+$1.15K','+$3.08K','+$1.05K','+$5.35K','-$350','+$600','+$1.09K','-$350','-$638','+$556'].map((n,i)=><div className={'cal-day '+(n[0] === '+' ? 'up':'down')} key={i}><small>{i+1}</small><b>{n}</b><em>{i+1} trades</em></div>)}</div></div>
    </div>
    <div className="ai-float"><div className="ai-avatar"><Sparkles size={20}/></div><small>TRADELOOP AI</small><p>What if I only traded my top 2 setups?</p><strong>+$2,140</strong><span>Your gap-fill and morning breakout account for 137% of your profits.</span></div>
    <div className="sync-float"><Check size={14}/><div><small>AUTO-SYNC SUCCESSFUL</small><strong>7 trades pulled from Topstep</strong></div></div>
  </div>
}

export default function Page() {
  const [active, setActive] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [productsOpen, setProductsOpen] = useState(false)
  const product = products[active]
  return <main className="home-root">
    <header className="site-header"><Logo/><nav className={menuOpen ? 'mobile-open' : ''}>
      {/* Hover-to-open is for mice only: a tap also fires the enter event,
          which would open the menu just before the tap's click toggled it
          shut again, leaving it impossible to open on touch screens. */}
      <div className="nav-item" onPointerEnter={e => { if (e.pointerType === 'mouse') setProductsOpen(true) }} onPointerLeave={e => { if (e.pointerType === 'mouse') setProductsOpen(false) }}>
        <button className={productsOpen ? 'nav-item-active' : ''} onClick={() => setProductsOpen(v => !v)}>Products <ChevronDown size={15}/></button>
        {productsOpen && <div className="products-menu">
          <div className="products-menu-grid">
            {navProducts.map(p => { const Icon = p.icon; return <div className="product-card" key={p.label}>
              <span className="product-card-icon"><Icon size={20}/></span>
              <div className="product-card-title">{p.label} {p.status === 'live' ? <span className="tag-live">LIVE</span> : <span className="tag-soon">COMING SOON</span>}</div>
              <p>{p.description}</p>
              {p.preview ? <ProductPreview kind={p.preview}/> : <div className="mini-preview soon-preview"><span>Coming soon</span></div>}
            </div> })}
          </div>
          <div className="products-menu-divider" />
          <div className="products-menu-side">
            {navMore.map(p => { const Icon = p.icon; return <div className="product-side-item" key={p.label}>
              <span className="product-card-icon small"><Icon size={17}/></span>
              <div><div className="product-card-title"><span>{p.label}</span><span className="tag-soon">SOON</span></div><p>{p.description}</p></div>
            </div> })}
          </div>
        </div>}
      </div>
      <Link href="/brokers">Supported Brokers</Link><Link href="/pricing">Pricing</Link><Link href="/sign-in">Log In</Link><Link href="/sign-up" className="button gradient">Get Started <ArrowRight size={16}/></Link></nav><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X/> : <Menu/>}</button>
    </header>
    <section className="hero"><div className="hero-inner"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot"/>THE SMARTER WAY TO TRADE</div><h1>Meet your<br/><span>AI trading</span><br/>partner.</h1><p>The trading journal that knows your trades, builds your game plan, and reviews every session automatically while you focus on the next one.</p><div className="hero-actions"><Link href="/sign-up" className="button btn-dark">Get Started <ArrowRight size={17}/></Link></div><div className="trusted"><div className="stars">★★★★★</div><div><strong>4.8 out of 5</strong><small>Trusted by profitable traders</small></div></div></div><DashboardMockup/></div></section>
    <section className="proof-wrap" id="brokers"><div className="proof-cta"><h2>Find Your Edge Right Now</h2></div><div className="broker-strip"><span className="broker-label">AUTO-SYNCS WITH</span><div className="broker"><Image src="/brokers/sm/FTMO.png" alt="" width={50} height={50} className="broker-icon broker-logo" unoptimized={false} /><span>FTMO</span></div><div className="broker"><Image src="/brokers/sm/topstep.png" alt="" width={50} height={50} className="broker-icon broker-logo" unoptimized={false} /><span>TopStep</span></div><div className="broker"><Image src="/brokers/sm/lucid.png" alt="" width={50} height={50} className="broker-icon broker-logo" unoptimized={false} /><span>Lucid Trading</span></div><div className="broker"><Image src="/brokers/sm/tradeify.png" alt="" width={50} height={50} className="broker-icon broker-logo" unoptimized={false} /><span>Tradeify</span></div><div className="broker"><Image src="/brokers/sm/rithmic.png" alt="" width={50} height={50} className="broker-icon broker-logo" unoptimized={false} /><span>Rithmic</span></div><div className="broker"><Image src="/brokers/sm/alphacapital.png" alt="" width={50} height={50} className="broker-icon broker-logo" unoptimized={false} /><span>Alpha Capital</span></div><span className="broker-more">+ every firm on Rithmic or MT4/5</span></div></section>
    <section className="products" id="products"><div className="section-heading"><div><div className="eyebrow">EVERYTHING IN ONE PLACE · 6 TOOLS</div><h2>Six products.<br/><em>One hub.</em></h2></div><p>Everything that makes you a better trader — and nothing that doesn&apos;t.</p></div><div className="tabs" role="tablist">{products.map((item, i) => { const Icon = item.icon; return <button key={item.label} role="tab" aria-selected={active === i} className={active === i ? 'selected' : ''} onClick={() => setActive(i)}><Icon size={17}/>{item.label}</button> })}</div><div className="product-panel"><div className="product-copy"><div className="eyebrow">{product.eyebrow}{'soon' in product && product.soon ? <span className="eyebrow-soon">COMING SOON</span> : null}</div><h3>{product.title}</h3><p>{product.description}</p><ul>{product.bullets.map(b => <li key={b}><Check size={16}/>{b}</li>)}</ul><a className="text-link" href="#start">Explore {product.label} <ArrowRight size={16}/></a></div>{product.label === 'Backtesting' ? <BacktestingPreview/> : product.label === 'Trade Replay' ? <TradeReplayPreview/> : product.label === 'AI Insights' ? <AiInsightsPreview/> : product.label === 'Spaces' ? <SpacesPreview/> : product.label === 'Prop Firm Sync' ? <PropFirmSyncPreview/> : <div className="insight-card"><div className="insight-header"><span className="mini-icon"><product.icon size={18}/></span><div><small>TRADING INSIGHT</small><strong>Know your numbers</strong></div><span className="dots">•••</span></div><div className="insight-stat"><span>Average win</span><strong>+$482.60</strong><small>↑ 18.2% vs last month</small></div><div className="bars"><i style={{height:'40%'}}/><i style={{height:'62%'}}/><i style={{height:'52%'}}/><i style={{height:'78%'}}/><i style={{height:'68%'}}/><i style={{height:'94%'}}/><i style={{height:'81%'}}/></div></div>}</div></section>
    <section className="cta" id="start"><div className="cta-orb"/><div className="eyebrow">YOUR NEXT LEVEL STARTS HERE</div><h2>Trade with clarity.<br/><span>Grow with confidence.</span></h2><p>Join traders building better habits and better results.</p><Link href="/pricing" className="button gradient">Start your free trial <ArrowRight size={17}/></Link></section>
    <footer><Logo/><span>© 2026 Tradeloop. Built for better trading.</span><div><Link href="/pricing">Pricing</Link><Link href="/sign-in">Log in</Link><Link href="/sign-up">Get started</Link></div></footer>
  </main>
}
