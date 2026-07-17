import { describe, expect, it } from 'vitest'
import { parseImports } from './import'

describe('parseImports', () => {
  it('normalizes JSONL imports', () => {
    expect(parseImports('set.jsonl', '{"text":" A "}\n')).toEqual(['A'])
  })
})
