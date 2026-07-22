export type DocumentStatus = 'draft' | 'reviewed'
export type Label = { id: string; name: string; color: string; description?: string }
export type EntitySpan = { id: string; documentId: string; start: number; end: number; labelId: string }
export type DatasetDocument = { id: string; text: string; source: string; status: DocumentStatus; createdAt: string; entities: EntitySpan[] }
export type Project = { id: string; name: string; path: string; labels: Label[]; documents: DatasetDocument[]; totalDocuments: number; page: number; pageSize: number }
export type AiSuggestion = { id: string; start: number; end: number; label: string; confidence: number }

export const uid = () => crypto.randomUUID()

export function validateSpan(text: string, span: Pick<EntitySpan, 'start' | 'end'>, existing: Pick<EntitySpan, 'start' | 'end'>[] = []) {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > text.length || span.start >= span.end) return 'Span must be within document boundaries.'
  if (existing.some((item) => span.start < item.end && span.end > item.start)) return 'Entity spans cannot overlap.'
  return null
}

export function toJsonl(documents: DatasetDocument[], labels: Label[]) {
  const labelById = new Map(labels.map((label) => [label.id, label.name]))
  const records = documents.map((doc) => ({
    text: doc.text,
    entities: [...doc.entities].sort((a, b) => a.start - b.start).map((entity) => ({ start: entity.start, end: entity.end, label: labelById.get(entity.labelId) ?? 'UNKNOWN' })),
  }))
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '')
}

export function parseImports(name: string, contents: string) {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'jsonl') return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const row = JSON.parse(line) as { text?: unknown }
    if (typeof row.text !== 'string' || !row.text.trim()) throw new Error(`Line ${index + 1} is missing a text field.`)
    return row.text.trim()
  })
  if (ext === 'csv') return contents.split(/\r?\n/).filter(Boolean).slice(1).map((line) => line.split(',')[0].replace(/^"|"$/g, '').trim()).filter(Boolean)
  return contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}
