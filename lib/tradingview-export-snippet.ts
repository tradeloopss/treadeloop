// A read-only snippet the trader runs in their own browser console, on their
// own TradingView tab, to copy their paper-trading history to the clipboard.
//
// This exists because TradingView gates every automatic route behind a paid
// plan: webhooks need Essential or higher, strategy alerts are a paid
// "technical alert", and even the Trading Panel's own Export data… button is
// paid. On the free plan the rows are on screen and nowhere else, so the
// trader copies them out themselves and pastes them into TradeLoop.
//
// It only reads the table that's already rendered and writes to the
// clipboard — no credentials, no requests, nothing sent anywhere. Kept short
// on purpose so it can be read before it's run.
export function tradingviewExportSnippet(): string {
  return `(() => {
  const table = document.querySelector('.js-page.active .ka-table, [class*="ka-table"], table');
  if (!table) return alert('Open the Trading Panel and pick its History tab, then run this again.');
  const text = [...table.querySelectorAll('tr')]
    .map(tr => [...tr.children].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).join('\\t'))
    .filter(line => line.replace(/\\t/g, '').length)
    .join('\\n');
  const rows = Math.max(0, text.split('\\n').length - 1);
  navigator.clipboard.writeText(text).then(
    () => alert('Copied ' + rows + ' rows. Paste them into TradeLoop.'),
    () => { console.log(text); alert('Clipboard blocked — the rows are in the console, copy them from there.'); }
  );
})();`
}
