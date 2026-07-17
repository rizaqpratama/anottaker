import { describe, expect, it } from 'vitest'
import { estimateCost, loadPricingTable, parsePricingCsv, PRICING_CSV_CONTENT } from './pricing'

describe('parsePricingCsv', () => {
  it('parses the embedded pricing table', () => {
    const table = parsePricingCsv(PRICING_CSV_CONTENT)
    expect(table.get('gpt-5-mini')).toEqual({ input: 0.25, cachedInput: 0.025, output: 2 })
  })

  it('handles rows missing the trailing output field via cache_write', () => {
    const table = parsePricingCsv(PRICING_CSV_CONTENT)
    expect(table.get('gpt-5.2')).toEqual({ input: 1.75, cachedInput: 0.175, output: 14 })
  })
})

describe('estimateCost', () => {
  const table = loadPricingTable()

  it('returns null for an unknown model', () => {
    expect(estimateCost(table, 'unknown-model', { inputTokens: 100, outputTokens: 50 })).toBeNull()
  })

  it('estimates cost from token usage', () => {
    const cost = estimateCost(table, 'gpt-5-mini', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(0.25 + 2)
  })
})
