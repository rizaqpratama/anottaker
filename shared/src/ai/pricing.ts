export type ModelPricing = { input: number; cachedInput: number | null; output: number }
export type UsageStats = { inputTokens: number; outputTokens: number; cachedInputTokens?: number }

export function parsePricingCsv(csv: string): Map<string, ModelPricing> {
  const [header, ...rows] = csv.replace(/^﻿/, '').trim().split(/\r?\n/)
  const fields = header.split(',')
  return new Map(rows.map((row) => {
    const values = row.split(',')
    const entry = Object.fromEntries(fields.map((field, index) => [field, values[index]?.trim() || ''])) as Record<string, string>
    return [entry.item, {
      input: Number(entry.input),
      cachedInput: entry.cached_input && entry.cached_input !== '-' ? Number(entry.cached_input) : null,
      // Some supplied rows omit the trailing output field and place that rate in cache_write.
      output: Number(entry.output || entry.cache_write),
    }] as [string, ModelPricing]
  }).filter(([model, pricing]) => model && Number.isFinite(pricing.input) && Number.isFinite(pricing.output)))
}

export function estimateCost(pricingTable: Map<string, ModelPricing>, model: string, usage: UsageStats): number | null {
  const pricing = pricingTable.get(model)
  if (!pricing) return null

  const cachedInputTokens = Math.min(usage.inputTokens, usage.cachedInputTokens || 0)
  const standardInputTokens = usage.inputTokens - cachedInputTokens
  const inputCost = ((standardInputTokens * pricing.input) + (cachedInputTokens * (pricing.cachedInput ?? pricing.input))) / 1_000_000
  return inputCost + (usage.outputTokens * pricing.output) / 1_000_000
}

// Embedded so RN/Hermes consumers (no arbitrary filesystem access) can use the pricing
// table without a bundler asset step. Keep in sync with data/pricing.csv by hand — it's
// a small, infrequently-updated table. Node/Electron consumers may prefer to read
// data/pricing.csv from disk directly so pricing can be updated without a rebuild;
// this constant is the fallback/RN path.
export const PRICING_CSV_CONTENT = `item,input,cached_input,cache_write,output
gpt-5.6-sol,5,0.5,6.25,30
gpt-5.6-terra,2.5,0.25,3.125,15
gpt-5.6-luna,1,0.1,1.25,6
gpt-5.5,5,0.5,-,30
gpt-5.5-pro,30,-,-,180
gpt-5.4,2.5,0.25,-,15
gpt-5.4-mini,0.75,0.075,-,4.5
gpt-5.4-nano,0.2,0.02,-,1.25
gpt-5.4-pro,30,-,-,180
gpt-5.2,1.75,0.175,14,
gpt-5.2-pro,21,-,168,
gpt-5.1,1.25,0.125,10,
gpt-5,1.25,0.125,10,
gpt-5-mini,0.25,0.025,2,
gpt-5-nano,0.05,0.005,0.4,
gpt-5-pro,15,,120,
gpt-4.1,2,0.5,8,
gpt-4.1-mini,0.4,0.1,1.6,
gpt-4.1-nano,0.1,0.025,0.4,
gpt-4o,2.5,1.25,10,
gpt-4o-2024-05-13,5,,15,
gpt-4o-mini,0.15,0.075,0.6,
o1,15,7.5,60,
o1-pro,150,,600,
o3-pro,20,,80,
o3,2,0.5,8,
o4-mini,1.1,0.275,4.4,
o3-mini,1.1,0.55,4.4,
o1-mini,1.1,0.55,4.4,
gpt-4-turbo-2024-04-09,10,,30,
gpt-4-0125-preview,10,,30,
gpt-4-1106-preview,10,,30,
gpt-4-1106-vision-preview,10,,30,
gpt-4-0613,30,,60,
gpt-4-0314,30,,60,
gpt-4-32k,60,,120,
gpt-3.5-turbo,0.5,,1.5,
gpt-3.5-turbo-0125,0.5,,1.5,
gpt-3.5-turbo-1106,1,,2,
gpt-3.5-turbo-0613,1.5,,2,
gpt-3.5-0301,1.5,,2,
gpt-3.5-turbo-instruct,1.5,,2,
gpt-3.5-turbo-16k-0613,3,,4,
davinci-002,2,,2,
babbage-002,0.4,,0.4,
gemini-3.5-flash,1.5,0.15,-,9
gemini-3.1-flash-lite,0.25,0.025,-,1.5
gemini-3.1-pro-preview,2,0.2,-,12
`

export function loadPricingTable(): Map<string, ModelPricing> {
  return parsePricingCsv(PRICING_CSV_CONTENT)
}
