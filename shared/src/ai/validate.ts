import { uid } from '../id'
import type { AiSuggestion, Label } from '../types'

export type RawSuggestionEntity = { start: number; end: number; text: string; label: string; confidence: number }

export function closestTextOffset(documentText: string, text: string, expectedStart: number) {
  const matches: number[] = []
  for (let start = documentText.indexOf(text); start >= 0; start = documentText.indexOf(text, start + 1)) matches.push(start)
  if (!matches.length) return null
  return matches.sort((a, b) => Math.abs(a - expectedStart) - Math.abs(b - expectedStart))[0]
}

export function validateSuggestions(documentText: string, labels: Label[], entities: RawSuggestionEntity[]): AiSuggestion[] {
  const labelsByLowerName = new Map(labels.map((label) => [label.name.toLowerCase(), label.name]))
  const normalized: (RawSuggestionEntity & { label: string })[] = []

  for (const entity of entities) {
    const label = labelsByLowerName.get(entity.label.toLowerCase())
    if (!label) continue

    let start = entity.start
    let end = entity.end
    // Providers sometimes return an offset that is off by one. The exact entity text is
    // authoritative only when it occurs in the source document, nearest to the given offset.
    if (end > documentText.length || start >= end || documentText.slice(start, end) !== entity.text) {
      const nearest = closestTextOffset(documentText, entity.text, entity.start)
      if (nearest === null) continue
      start = nearest
      end = start + entity.text.length
    }
    normalized.push({ ...entity, label, start, end })
  }

  const accepted: (RawSuggestionEntity & { label: string; id: string })[] = []
  const usedLabels = new Set<string>()
  for (const entity of normalized.sort((a, b) => b.confidence - a.confidence)) {
    if (usedLabels.has(entity.label)) continue
    if (accepted.some((item) => entity.start < item.end && entity.end > item.start)) continue
    usedLabels.add(entity.label)
    accepted.push({ ...entity, id: uid() })
  }

  return accepted.sort((a, b) => a.start - b.start)
}
