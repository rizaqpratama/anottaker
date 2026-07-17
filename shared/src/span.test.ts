import { describe, expect, it } from 'vitest'
import { validateSpan } from './span'

describe('validateSpan', () => {
  it('rejects invalid and overlapping spans', () => {
    expect(validateSpan('hello', { start: 2, end: 2 })).toBeTruthy()
    expect(validateSpan('hello', { start: 1, end: 4 }, [{ start: 0, end: 2 }])).toBeTruthy()
  })
  it('accepts a valid, non-overlapping span', () => {
    expect(validateSpan('hello', { start: 0, end: 2 }, [{ start: 3, end: 5 }])).toBeNull()
  })
})
