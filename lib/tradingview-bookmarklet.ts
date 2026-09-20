// A one-tap sync for a phone or tablet, where a browser extension can't run.
//
// The trader saves this as a bookmark and taps it while TradingView is open
// and logged in. It runs inside TradingView's own page, so it reads the same
// paper endpoints the extension reads using the session the trader is already
// logged into — no password is asked for, sent, or stored — and posts the
// fills to the paired journal with the pairing token.
//
// It is the bookmark form of the console snippet the paste route already
// ships (lib/tradingview-export-snippet.ts): the trader's own logged-in
// session, code they run themselves on a tap. There is no server-side path —
// TradingView has no third-party API for paper accounts and their login sits
// behind a bot check, a captcha and 2FA — so this is what "automatic on
// mobile" actually looks like without holding a credential that could log in
// even if we wanted it to.

const DEFAULT_PAPER_HOST = "https://papertrading.tradingview.com"

export function tradingviewBookmarklet(baseUrl: string, token: string, paperHost: string = DEFAULT_PAPER_HOST): string {
  const paperHostName = safeHost(paperHost)
  // Kept tiny and dependency-free so it fits in a bookmark. It reads the pro
  // paper host (the free one only exists behind a TradingView feature flag),
  // sends every fill it finds, and lets the server dedupe — a bookmark tap
  // is occasional, so there's no acked-id bookkeeping to keep.
  const source = `(async()=>{
    var BASE=${JSON.stringify(baseUrl)},TOKEN=${JSON.stringify(token)},HOST=${JSON.stringify(paperHost)},PHOST=${JSON.stringify(paperHostName)};
    if(!(location.host.endsWith("tradingview.com")||location.host===PHOST)){alert("Open TradingView first (logged in), then tap this bookmark.");return;}
    var pf=async function(p,b){var r=await fetch(HOST+"/"+p,{method:"POST",credentials:"include",headers:{"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8"},body:b===undefined?undefined:JSON.stringify(b)});if(r.status===401||r.status===403)throw"login";if(!r.ok)throw"tv"+r.status;return r.json()};
    try{
      var raw=await pf("trading/accounts");
      var list=Array.isArray(raw)?raw:(raw&&raw.accounts)||[];
      var accounts=[];
      for(var i=0;i<list.length;i++){var a=list[i];if(!a||a.accountId==null||a.hidden)continue;
        var ex=await pf("trading/get_trades/"+a.accountId,{limit:1000});
        accounts.push({accountId:String(a.accountId),name:a.name==null?null:a.name,default:a.default===true,currency:a.currency||"USD",balance:typeof a.balance==="number"?a.balance:null,initialBalance:typeof a.initialBalance==="number"?a.initialBalance:null,executions:(Array.isArray(ex)?ex:[]).map(function(e){return{id:String(e.id),symbol:e.symbol,side:e.side,qty:e.qty,price:e.price,time:e.time,commission:e.commission==null?null:e.commission,order:e.order==null?null:e.order}})});
      }
      var res=await fetch(BASE+"/api/tradingview/extension",{method:"POST",headers:{Authorization:"Bearer "+TOKEN,"Content-Type":"application/json"},body:JSON.stringify({version:"bookmarklet",browser:"Phone",accounts:accounts})});
      var out=await res.json().catch(function(){return{}});
      if(res.status===401){alert("This bookmark isn't paired any more — set it up again in TradeLoop.");return;}
      if(!res.ok||!out.ok){alert("TradeLoop sync failed: "+((out&&out.error)||res.status));return;}
      var trades=0,fills=0;(out.accounts||[]).forEach(function(x){trades+=x.newTrades||0;fills+=x.newFills||0;});
      alert(fills?("TradeLoop: "+fills+" new fill"+(fills===1?"":"s")+", "+trades+" trade"+(trades===1?"":"s")+" journaled."):"TradeLoop: already up to date.");
    }catch(e){alert(e==="login"?"Log in to TradingView first, then tap the bookmark again.":"Couldn't reach TradingView paper trading ("+e+").");}
  })();`

  return "javascript:" + encodeURIComponent(source.replace(/\n\s*/g, ""))
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "papertrading.tradingview.com"
  }
}
