const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const express = require('express')
const multer = require('multer')
const OpenAI = require('openai')
const { ProjectDatabase } = require('./database.cjs')
const { suggestEntities } = require('./ai.cjs')
const { AGENT_PROFILES, acpRuntimeStatus, clearLocalAgentContext, discoverLocalAgents, listLocalAgentModels, restartLocalAgent } = require('./local-agent.cjs')
const { readSettings, writeSettings, encryptSecret, decryptSecret } = require('./settings.cjs')
const { freeProjectPath, saveUploadedProject, rememberProject, recentProjects } = require('./projects.cjs')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } })

let project
let activePage = 0
let activeSearchQuery = ''
const pageSize = 100

const sseClients = new Set()
function broadcast() {
  const payload = `data: ${JSON.stringify(project?.snapshot(activePage, pageSize, activeSearchQuery) || null)}\n\n`
  for (const res of sseClients) res.write(payload)
}

function requireProject() {
  if (!project) throw new Error('Open or create a project first.')
}

// Every route wraps its handler so thrown errors become { error: message } responses —
// the frontend bridge surfaces `error.message` exactly like the Electron IPC rejections did.
function handler(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res)
      if (!res.headersSent) res.json(result === undefined ? null : result)
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Something went wrong.' })
    }
  }
}

const router = express.Router()

// No initial snapshot is sent on connect — like the Electron renderer, a fresh page
// load always starts at the Welcome screen; this stream only pushes *subsequent*
// changes, exactly mirroring webContents.send('project:changed', ...) in main.cjs.
router.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders()
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

router.post('/project/create', handler((req) => {
  const name = (req.body?.name || '').trim() || 'Untitled project'
  const filePath = freeProjectPath(name)
  project?.close()
  project = new ProjectDatabase(filePath)
  activePage = 0
  activeSearchQuery = ''
  project.initialize(name)
  const snapshot = project.snapshot(activePage, pageSize, activeSearchQuery)
  rememberProject(snapshot.path, snapshot.name)
  broadcast()
  return snapshot
}))

router.post('/project/open', upload.single('file'), handler((req) => {
  if (!req.file) throw new Error('Choose a .nerdb project file to open.')
  const filePath = saveUploadedProject(req.file.buffer, req.file.originalname)
  project?.close()
  project = new ProjectDatabase(filePath)
  activePage = 0
  activeSearchQuery = ''
  const snapshot = project.snapshot(activePage, pageSize, activeSearchQuery)
  rememberProject(snapshot.path, snapshot.name)
  broadcast()
  return snapshot
}))

router.get('/project/recent', handler(() => recentProjects()))

router.post('/project/open-recent', handler((req) => {
  const filePath = req.body?.path
  if (!filePath || !fs.existsSync(filePath)) { recentProjects(); throw new Error('This project file is no longer available.') }
  project?.close()
  project = new ProjectDatabase(filePath)
  activePage = 0
  activeSearchQuery = ''
  const snapshot = project.snapshot(activePage, pageSize, activeSearchQuery)
  rememberProject(snapshot.path, snapshot.name)
  broadcast()
  return snapshot
}))

router.get('/project/page', handler((req) => {
  requireProject()
  activePage = Math.max(0, Number(req.query.page) || 0)
  return project.snapshot(activePage, pageSize, activeSearchQuery)
}))

router.get('/project/search', handler((req) => {
  requireProject()
  if (req.query.query !== undefined && typeof req.query.query !== 'string') throw new Error('Search text must be a string.')
  activeSearchQuery = (req.query.query || '').trim().slice(0, 500)
  activePage = 0
  return project.snapshot(activePage, pageSize, activeSearchQuery)
}))

router.get('/project/document/:id', handler((req) => {
  requireProject()
  return project.getDocument(req.params.id)
}))

router.post('/documents/import', handler((req) => {
  requireProject()
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.filter((text) => typeof text === 'string' && text.trim()) : []
  project.addDocuments(texts)
  broadcast()
  return { count: texts.length }
}))

router.post('/labels', handler((req) => {
  requireProject()
  project.addLabel(req.body)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.put('/labels/:id', handler((req) => {
  requireProject()
  project.updateLabel({ ...req.body, id: req.params.id })
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.delete('/labels/:id', handler((req) => {
  requireProject()
  project.removeLabel(req.params.id)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.post('/entities', handler((req) => {
  requireProject()
  project.addEntity(req.body)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.delete('/entities/:id', handler((req) => {
  requireProject()
  project.removeEntity(req.params.id)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.delete('/documents/:id/entities', handler((req) => {
  requireProject()
  project.clearEntities(req.params.id)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.delete('/documents/:id', handler((req) => {
  requireProject()
  project.deleteDocument(req.params.id)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.patch('/documents/:id/status', handler((req) => {
  requireProject()
  project.setStatus(req.params.id, req.body?.status)
  broadcast()
  return project.snapshot(activePage, pageSize)
}))

router.get('/project/export', (req, res) => {
  try {
    requireProject()
    const reviewedOnly = req.query.reviewedOnly === 'true'
    const tmpPath = path.join(os.tmpdir(), `nertator-export-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
    const count = project.exportJsonl(tmpPath, reviewedOnly)
    res.set('X-Export-Count', String(count))
    res.set('Access-Control-Expose-Headers', 'X-Export-Count')
    res.download(tmpPath, 'dataset.jsonl', () => fs.unlink(tmpPath, () => {}))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not export this project.' })
  }
})

router.post('/settings/key', handler((req) => {
  const key = req.body?.key || ''
  if (!key.trim()) throw new Error('Enter an OpenAI API key.')
  writeSettings({ ...readSettings(), openaiKey: encryptSecret(key) })
  return true
}))

router.get('/settings/has-key', handler(() => Boolean(readSettings().openaiKey)))

router.get('/settings/model', handler(() => readSettings().openaiModel || readSettings().model || 'gpt-5-mini'))

router.post('/settings/model', handler((req) => {
  const model = req.body?.model
  if (typeof model !== 'string' || !model.trim()) throw new Error('Choose a valid OpenAI model.')
  writeSettings({ ...readSettings(), openaiModel: model })
  return model
}))

router.post('/settings/gemini-key', handler((req) => {
  const key = req.body?.key || ''
  if (!key.trim()) throw new Error('Enter a Gemini API key.')
  writeSettings({ ...readSettings(), geminiKey: encryptSecret(key) })
  return true
}))

router.get('/settings/provider', handler(() => readSettings().provider || 'openai'))

router.post('/settings/provider', handler((req) => {
  const provider = req.body?.provider
  if (!['openai', 'gemini', 'local-agent'].includes(provider)) throw new Error('Choose a valid provider.')
  writeSettings({ ...readSettings(), provider })
  return provider
}))

router.get('/settings/gemini-model', handler(() => readSettings().geminiModel || 'gemini-2.5-flash'))

router.post('/settings/gemini-model', handler((req) => {
  const model = req.body?.model
  if (typeof model !== 'string' || !model.startsWith('gemini-')) throw new Error('Choose a valid Gemini model.')
  writeSettings({ ...readSettings(), geminiModel: model })
  return model
}))

router.get('/settings/local-agent', handler(() => readSettings().localAgent || 'codex'))

router.post('/settings/local-agent', handler(async (req) => {
  const agent = req.body?.agent
  if (!AGENT_PROFILES[agent]) throw new Error('Choose a supported local coding agent.')
  const settings = readSettings()
  if (settings.localAgent && settings.localAgent !== agent) await restartLocalAgent(settings.localAgent)
  writeSettings({ ...settings, localAgent: agent })
  return agent
}))

router.get('/settings/local-agent-model', handler(() => readSettings().localAgentModel || ''))

router.post('/settings/local-agent-model', handler((req) => {
  const model = req.body?.model
  if (typeof model !== 'string' || model.length > 200) throw new Error('Choose a valid local agent model override.')
  writeSettings({ ...readSettings(), localAgentModel: model.trim() })
  return model.trim()
}))

router.get('/settings/ai-prompt', handler(() => readSettings().aiPrompt || ''))

router.post('/settings/ai-prompt', handler((req) => {
  const prompt = req.body?.prompt
  if (typeof prompt !== 'string' || prompt.length > 10_000) throw new Error('Custom AI instructions must be text under 10,000 characters.')
  writeSettings({ ...readSettings(), aiPrompt: prompt })
  return prompt
}))

router.get('/ai/models', handler(async () => {
  const cipher = readSettings().openaiKey
  if (!cipher) throw new Error('Save an OpenAI API key before loading models.')
  const client = new OpenAI({ apiKey: decryptSecret(cipher) })
  let page = await client.models.list()
  const models = [...page.data]
  while (page.hasNextPage()) { page = await page.getNextPage(); models.push(...page.data) }
  return models.map((model) => model.id).sort((a, b) => a.localeCompare(b))
}))

router.get('/ai/local-agents', handler(() => discoverLocalAgents()))
router.get('/ai/local-agent-models/:agent', handler((req) => listLocalAgentModels(req.params.agent)))
router.get('/ai/local-agent-runtime/:agent', handler((req) => {
  if (!AGENT_PROFILES[req.params.agent]) throw new Error('Choose a supported local coding agent.')
  return acpRuntimeStatus(req.params.agent)
}))
router.post('/ai/restart-local-agent/:agent', handler((req) => restartLocalAgent(req.params.agent)))
router.post('/ai/clear-local-agent-context/:agent', handler((req) => clearLocalAgentContext(req.params.agent)))

router.post('/ai/suggest', handler((req) => {
  requireProject()
  const document = req.body
  const canonicalDocument = project.getDocument(document.id)
  if (!canonicalDocument) throw new Error('This document no longer exists.')
  const data = project.snapshot()
  return suggestEntities({
    documentText: canonicalDocument.text,
    labels: data.labels,
    settings: readSettings(),
    decryptKey: decryptSecret,
  })
}))

async function shutdown() {
  const { shutdownLocalAgents } = require('./local-agent.cjs')
  await shutdownLocalAgents().catch(() => {})
  project?.close()
}

module.exports = { router, shutdown }
