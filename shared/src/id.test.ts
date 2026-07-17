import { afterEach, describe, expect, it } from 'vitest'
import { setIdGenerator, uid } from './id'

describe('uid', () => {
  afterEach(() => setIdGenerator(() => crypto.randomUUID()))

  it('defaults to crypto.randomUUID()', () => {
    expect(uid()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('supports an injected generator for RN/Hermes', () => {
    setIdGenerator(() => 'fixed-id')
    expect(uid()).toBe('fixed-id')
  })
})
