import type { EntitySpan } from './types'

export function validateSpan(text: string, span: Pick<EntitySpan, 'start' | 'end'>, existing: Pick<EntitySpan, 'start' | 'end'>[] = []) {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > text.length || span.start >= span.end) return 'Span must be within document boundaries.'
  if (existing.some((item) => span.start < item.end && span.end > item.start)) return 'Entity spans cannot overlap.'
  return null
}
