import { describe, expect, it } from 'vitest'
import { toJsonl } from './export'

describe('toJsonl', () => {
  it('creates portable JSONL records', () => {
    const output = toJsonl(
      [{ id: 'd', text: 'Ada', source: 'x', status: 'reviewed', createdAt: '', entities: [{ id: 'e', documentId: 'd', start: 0, end: 3, labelId: 'p' }] }],
      [{ id: 'p', name: 'PERSON', color: '#000' }],
    )
    expect(JSON.parse(output).entities[0]).toEqual({ start: 0, end: 3, label: 'PERSON' })
  })
})
