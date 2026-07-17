import { mkdir, cp } from 'node:fs/promises'
await mkdir('dist-electron', { recursive: true })
await cp('electron/main.cjs', 'dist-electron/main.cjs')
await cp('electron/preload.cjs', 'dist-electron/preload.cjs')
await cp('electron/database.cjs', 'dist-electron/database.cjs')
await cp('electron/ai.cjs', 'dist-electron/ai.cjs')
await cp('electron/local-agent.cjs', 'dist-electron/local-agent.cjs')
await cp('electron/acp-agent.cjs', 'dist-electron/acp-agent.cjs')
await cp('data', 'dist-electron/data', { recursive: true })
