import type { DatasetDocument, Label } from './types'

export function toJsonl(documents: DatasetDocument[], labels: Label[]) {
  const labelById = new Map(labels.map((label) => [label.id, label.name]))
  const records = documents.map((doc) => ({
    text: doc.text,
    entities: [...doc.entities].sort((a, b) => a.start - b.start).map((entity) => ({ start: entity.start, end: entity.end, label: labelById.get(entity.labelId) ?? 'UNKNOWN' })),
  }))
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '')
}
