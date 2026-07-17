import type { Label } from '../types'

export const NER_SYSTEM_PROMPT = `You are a precise named-entity recognition assistant for dataset annotation.

Only annotate labels supplied by the user. For each label, return at most one candidate: the highest-confidence match only. Omit labels with no confident match.

Every entity must use zero-based character offsets into the source text. The text field must exactly equal sourceText.slice(start, end), preserving all spaces and punctuation. Never infer or normalize text. Return no overlapping entities.`

export function buildNerPrompt(documentText: string, labels: Pick<Label, 'name' | 'description'>[]) {
  return JSON.stringify({
    labels: labels.map(({ name, description }) => ({ name, description: description || '' })),
    sourceText: documentText,
  })
}

export function buildSystemPrompt(customInstructions = '') {
  const instructions = customInstructions.trim()
  return instructions ? `${NER_SYSTEM_PROMPT}\n\nAdditional project instructions:\n${instructions}` : NER_SYSTEM_PROMPT
}
