import { describe, expect, it } from 'vitest'
import { closestTextOffset, validateSuggestions } from './validate'

describe('closestTextOffset', () => {
  it('picks the occurrence nearest the expected start', () => {
    expect(closestTextOffset('Ada saw Ada again', 'Ada', 9)).toBe(8)
  })
  it('returns null when the text does not occur', () => {
    expect(closestTextOffset('Ada saw Ada again', 'Grace', 0)).toBeNull()
  })
})

describe('validateSuggestions', () => {
  const labels = [{ id: 'p', name: 'PERSON', color: '#000' }]

  it('drops suggestions for undefined labels', () => {
    const result = validateSuggestions('Ada Lovelace', labels, [{ start: 0, end: 3, text: 'Ada', label: 'PLACE', confidence: 0.9 }])
    expect(result).toEqual([])
  })

  it('accepts an exact-match span, matching labels case-insensitively', () => {
    const result = validateSuggestions('Ada Lovelace', labels, [{ start: 0, end: 3, text: 'Ada', label: 'person', confidence: 0.9 }])
    expect(result).toMatchObject([{ start: 0, end: 3, label: 'PERSON' }])
  })

  it('falls back to nearest-occurrence matching when the given offset is off', () => {
    const result = validateSuggestions('x Ada Lovelace', labels, [{ start: 0, end: 3, text: 'Ada', label: 'PERSON', confidence: 0.9 }])
    expect(result).toMatchObject([{ start: 2, end: 5 }])
  })

  it('keeps only the highest-confidence suggestion per label and rejects overlaps', () => {
    const result = validateSuggestions('Ada Lovelace', labels, [
      { start: 0, end: 3, text: 'Ada', label: 'PERSON', confidence: 0.5 },
      { start: 0, end: 12, text: 'Ada Lovelace', label: 'PERSON', confidence: 0.9 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ start: 0, end: 12 })
  })
})
