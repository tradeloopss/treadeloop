import Anthropic from "@anthropic-ai/sdk"
import { recordApiUsage } from "@/lib/telemetry"

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null

type DayTrade = {
  symbol: string
  side: string
  status: string
  pnl: string
  rMultiple: string | null
  rating: number | null
  mistakes: unknown
  tags: unknown
  notes: string | null
}

// Returns null when no API key is configured or the call fails — callers
// should fall back to a templated summary in that case.
export async function generateDailyNarrative(day: string, dayTrades: DayTrade[]): Promise<string | null> {
  if (!client) return null

  const lines = dayTrades.map((t) => {
    const pnl = Number(t.pnl)
    const parts = [`${t.symbol} ${t.side} (${t.status})`, `P&L ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`]
    if (t.rMultiple) parts.push(`${Number(t.rMultiple).toFixed(2)}R`)
    if (t.rating) parts.push(`rated ${t.rating}/5`)
    const mistakes = Array.isArray(t.mistakes) ? t.mistakes : []
    if (mistakes.length) parts.push(`mistakes: ${mistakes.join(", ")}`)
    const tags = Array.isArray(t.tags) ? t.tags : []
    if (tags.length) parts.push(`tags: ${tags.join(", ")}`)
    if (t.notes) parts.push(`notes: "${t.notes}"`)
    return `- ${parts.join(" | ")}`
  })

  const prompt = `You are a trading journal assistant. Write a short (2-4 sentence) daily summary of this trader's day, in second person ("You..."), based only on the data below. Be specific and factual: mention the win/loss pattern and any notable trade, and end with one concrete, actionable observation only if the data actually supports it (e.g. a repeated mistake or a strong setup) — don't invent one. Plain prose only, no markdown, no headers.

Date: ${day}
Trades:
${lines.join("\n")}`

  const startedAt = Date.now()
  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 400,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    })
    void recordApiUsage({
      provider: "anthropic",
      operation: "journal_narrative",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      startedAt,
    })
    const block = response.content.find((b) => b.type === "text")
    const text = block && "text" in block ? block.text.trim() : ""
    return text || null
  } catch (err) {
    void recordApiUsage({ provider: "anthropic", operation: "journal_narrative", startedAt, error: err })
    return null
  }
}
