// Implements the same `window.ner` surface as electron/preload.cjs, backed by fetch()
// calls to the local Express server instead of Electron IPC, so src/main.tsx (copied
// unmodified from the desktop app) needs no changes at all.
import { parseImports } from './shared'
import type { DatasetDocument, DocumentStatus, EntitySpan, Label, Project } from './shared'

async function handleResponse(res: Response) {
  if (!res.ok) {
    let message = `Request failed (${res.status}).`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // response wasn't JSON; keep the generic message
    }
    throw new Error(message)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function call(path: string, method: string, body?: unknown) {
  return fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(handleResponse)
}

// A native browser file picker stands in for Electron's native open-file dialog.
// It resolves null if the user cancels (detected via the window regaining focus
// without a 'change' event ever firing).
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    const cleanup = (file: File | null) => { input.remove(); resolve(file) }
    input.addEventListener('change', () => cleanup(input.files?.[0] || null), { once: true })
    const onFocus = () => {
      window.removeEventListener('focus', onFocus)
      setTimeout(() => { if (document.body.contains(input)) cleanup(null) }, 300)
    }
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

window.ner = {
  createProject: (name) => call('/project/create', 'POST', { name }),

  openProject: async () => {
    const file = await pickFile('.nerdb')
    if (!file) return null
    const form = new FormData()
    form.append('file', file, file.name)
    return fetch('/api/project/open', { method: 'POST', body: form }).then(handleResponse)
  },

  recentProjects: () => call('/project/recent', 'GET'),
  openRecentProject: (filePath) => call('/project/open-recent', 'POST', { path: filePath }),

  importDocuments: async () => {
    const file = await pickFile('.txt,.csv,.jsonl')
    if (!file) return null
    const contents = await file.text()
    const texts = parseImports(file.name, contents)
    return call('/documents/import', 'POST', { texts })
  },

  loadPage: (page) => call(`/project/page?page=${page}`, 'GET'),
  searchDocuments: (query) => call(`/project/search?query=${encodeURIComponent(query)}`, 'GET'),
  getDocument: (id) => call(`/project/document/${encodeURIComponent(id)}`, 'GET'),

  addLabel: (label: Label) => call('/labels', 'POST', label),
  updateLabel: (label: Label) => call(`/labels/${encodeURIComponent(label.id)}`, 'PUT', label),
  removeLabel: (id) => call(`/labels/${encodeURIComponent(id)}`, 'DELETE'),
  addEntity: (entity: EntitySpan) => call('/entities', 'POST', entity),
  removeEntity: (id) => call(`/entities/${encodeURIComponent(id)}`, 'DELETE'),
  clearEntities: (id) => call(`/documents/${encodeURIComponent(id)}/entities`, 'DELETE'),
  deleteDocument: (id) => call(`/documents/${encodeURIComponent(id)}`, 'DELETE'),
  setStatus: (id, status: DocumentStatus) => call(`/documents/${encodeURIComponent(id)}/status`, 'PATCH', { status }),

  exportProject: async (reviewedOnly) => {
    const res = await fetch(`/api/project/export?reviewedOnly=${reviewedOnly}`)
    if (!res.ok) return handleResponse(res)
    const count = Number(res.headers.get('X-Export-Count') || '0')
    const blob = await res.blob()
    downloadBlob(blob, 'dataset.jsonl')
    return { count, path: 'dataset.jsonl' }
  },

  suggest: (document: DatasetDocument) => call('/ai/suggest', 'POST', document),

  setKey: (key) => call('/settings/key', 'POST', { key }),
  setGeminiKey: (key) => call('/settings/gemini-key', 'POST', { key }),
  getProvider: () => call('/settings/provider', 'GET'),
  setProvider: (provider) => call('/settings/provider', 'POST', { provider }),
  getGeminiModel: () => call('/settings/gemini-model', 'GET'),
  setGeminiModel: (model) => call('/settings/gemini-model', 'POST', { model }),
  getLocalAgent: () => call('/settings/local-agent', 'GET'),
  setLocalAgent: (agent) => call('/settings/local-agent', 'POST', { agent }),
  getLocalAgentModel: () => call('/settings/local-agent-model', 'GET'),
  setLocalAgentModel: (model) => call('/settings/local-agent-model', 'POST', { model }),
  getAiPrompt: () => call('/settings/ai-prompt', 'GET'),
  setAiPrompt: (prompt) => call('/settings/ai-prompt', 'POST', { prompt }),
  hasKey: () => call('/settings/has-key', 'GET'),
  getModel: () => call('/settings/model', 'GET'),
  setModel: (model) => call('/settings/model', 'POST', { model }),
  listModels: () => call('/ai/models', 'GET'),
  listLocalAgents: () => call('/ai/local-agents', 'GET'),
  listLocalAgentModels: (agent) => call(`/ai/local-agent-models/${encodeURIComponent(agent)}`, 'GET'),
  localAgentRuntime: (agent) => call(`/ai/local-agent-runtime/${encodeURIComponent(agent)}`, 'GET'),
  restartLocalAgent: (agent) => call(`/ai/restart-local-agent/${encodeURIComponent(agent)}`, 'POST'),
  clearLocalAgentContext: (agent) => call(`/ai/clear-local-agent-context/${encodeURIComponent(agent)}`, 'POST'),

  onProjectChanged: (callback: (project: Project | null) => void) => {
    const source = new EventSource('/api/events')
    source.onmessage = (event) => callback(event.data ? JSON.parse(event.data) : null)
    return () => source.close()
  },
}
