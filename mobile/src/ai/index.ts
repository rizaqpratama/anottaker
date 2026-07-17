import { buildNerPrompt, buildSystemPrompt, estimateCost, loadPricingTable, nerResponseSchema, validateSuggestions } from '@nertator/shared'
import type { AiSuggestion, Label } from '@nertator/shared'
import { suggestWithGemini } from './gemini'
import { suggestWithOpenAI } from './openai'

export type AiProvider = 'openai' | 'gemini'

export type SuggestResult = {
  suggestions: AiSuggestion[]
  stats: {
    provider: AiProvider
    model: string
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    usageAvailable: boolean
    elapsedMs: number
    estimatedCost: number | null
  }
}

const pricingTable = loadPricingTable()

export async function suggestEntities({
  documentText,
  labels,
  provider,
  model,
  apiKey,
  customInstructions,
}: {
  documentText: string
  labels: Label[]
  provider: AiProvider
  model: string
  apiKey: string
  customInstructions: string
}): Promise<SuggestResult> {
  const started = Date.now()
  const userPrompt = buildNerPrompt(documentText, labels)
  const systemPrompt = buildSystemPrompt(customInstructions)

  const call = provider === 'gemini' ? suggestWithGemini : suggestWithOpenAI
  const { entities, usage } = await call({ apiKey, model, systemPrompt, userPrompt })
  // Re-validate the provider's raw JSON against the shared schema before trusting it,
  // same as desktop does for its structured-output responses.
  const parsed = nerResponseSchema.parse({ entities })
  const suggestions = validateSuggestions(documentText, labels, parsed.entities)

  return {
    suggestions,
    stats: {
      provider,
      model,
      ...usage,
      usageAvailable: true,
      elapsedMs: Date.now() - started,
      estimatedCost: estimateCost(pricingTable, model, usage),
    },
  }
}
