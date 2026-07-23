import { readFile } from 'node:fs/promises'
import { test, expect } from 'vitest'

test('development launcher starts the source Electron main process', async () => {
  const launcher = await readFile(new URL('./start-electron-dev.mjs', import.meta.url), 'utf8')

  expect(launcher).toMatch(/spawn\(electron, \['electron\/main\.cjs'\]/)
})
