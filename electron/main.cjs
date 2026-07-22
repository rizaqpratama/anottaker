const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const OpenAI = require('openai')
const { ProjectDatabase } = require('./database.cjs')
const { suggestEntities } = require('./ai.cjs')
const { AGENT_PROFILES, acpRuntimeStatus, clearLocalAgentContext, discoverLocalAgents, listLocalAgentModels, restartLocalAgent, shutdownLocalAgents } = require('./local-agent.cjs')

let win; let project; let activePage = 0; let activeSearchQuery = ''; const pageSize = 100
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) } catch { return {} } }
const writeSettings = (settings) => fs.writeFileSync(settingsPath(), JSON.stringify(settings), { mode: 0o600 })
const rememberProject = (projectPath, name) => { const settings = readSettings(); const recent = (settings.recentProjects || []).filter((item) => item.path !== projectPath); writeSettings({ ...settings, recentProjects: [{ path: projectPath, name, openedAt: new Date().toISOString() }, ...recent].slice(0, 8) }) }
const recentProjects = () => { const settings = readSettings(); const valid = (settings.recentProjects || []).filter((item) => fs.existsSync(item.path)); if (valid.length !== (settings.recentProjects || []).length) writeSettings({ ...settings, recentProjects: valid }); return valid }
const sendProject = () => win.webContents.send('project:changed', project?.snapshot(activePage, pageSize, activeSearchQuery) || null)
function requireProject() { if (!project) throw new Error('Open or create a project first.') }
function createWindow() { win = new BrowserWindow({ width: 1440, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#f7f7f5', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } }); win.loadURL(process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, '../dist/index.html')}`) }
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() }) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { shutdownLocalAgents().catch(() => {}) })

ipcMain.handle('project:create', async (_, name) => { const choice = await dialog.showSaveDialog(win, { title: 'Create NER project', defaultPath: `${name || 'untitled'}.nerdb`, filters: [{ name: 'NER project', extensions: ['nerdb'] }] }); if (choice.canceled || !choice.filePath) return null; project?.close(); project = new ProjectDatabase(choice.filePath); activePage = 0; activeSearchQuery = ''; project.initialize(name || 'Untitled project'); const snapshot = project.snapshot(activePage, pageSize, activeSearchQuery); rememberProject(snapshot.path, snapshot.name); sendProject(); return snapshot })
ipcMain.handle('project:open', async () => { const choice = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'NER project', extensions: ['nerdb'] }] }); if (choice.canceled || !choice.filePaths[0]) return null; project?.close(); project = new ProjectDatabase(choice.filePaths[0]); activePage = 0; activeSearchQuery = ''; const snapshot = project.snapshot(activePage, pageSize, activeSearchQuery); rememberProject(snapshot.path, snapshot.name); sendProject(); return snapshot })
ipcMain.handle('project:recent', () => recentProjects())
ipcMain.handle('project:open-recent', (_, filePath) => { if (!fs.existsSync(filePath)) { recentProjects(); throw new Error('This project file is no longer available.'); } project?.close(); project = new ProjectDatabase(filePath); activePage = 0; activeSearchQuery = ''; const snapshot = project.snapshot(activePage, pageSize, activeSearchQuery); rememberProject(snapshot.path, snapshot.name); sendProject(); return snapshot })
ipcMain.handle('project:page', (_, page) => { requireProject(); activePage = Math.max(0, page); return project.snapshot(activePage, pageSize, activeSearchQuery) })
ipcMain.handle('project:search', (_, query) => { requireProject(); if (typeof query !== 'string') throw new Error('Search text must be a string.'); activeSearchQuery = query.trim().slice(0, 500); activePage = 0; return project.snapshot(activePage, pageSize, activeSearchQuery) })
ipcMain.handle('project:document', (_, id) => { requireProject(); return project.getDocument(id) })
ipcMain.handle('project:import', async () => { requireProject(); const choice = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Text datasets', extensions: ['txt', 'csv', 'jsonl'] }] }); if (choice.canceled || !choice.filePaths[0]) return null; const filePath = choice.filePaths[0]; const contents = fs.readFileSync(filePath, 'utf8'); const ext = path.extname(filePath).toLowerCase(); let texts; if (ext === '.jsonl') texts = contents.split(/\r?\n/).filter(Boolean).map((line, index) => { const row = JSON.parse(line); if (typeof row.text !== 'string' || !row.text.trim()) throw new Error(`Line ${index + 1} is missing a text field.`); return row.text.trim() }); else if (ext === '.csv') texts = contents.split(/\r?\n/).filter(Boolean).slice(1).map((line) => line.split(',')[0].replace(/^"|"$/g, '').trim()).filter(Boolean); else texts = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); project.addDocuments(texts); sendProject(); return { count: texts.length } })
ipcMain.handle('project:add-label', (_, label) => { requireProject(); project.addLabel(label); sendProject(); return project.snapshot() })
ipcMain.handle('project:update-label', (_, label) => { requireProject(); project.updateLabel(label); sendProject(); return project.snapshot(activePage, pageSize) })
ipcMain.handle('project:remove-label', (_, id) => { requireProject(); project.removeLabel(id); sendProject(); return project.snapshot(activePage, pageSize) })
ipcMain.handle('project:add-entity', (_, entity) => { requireProject(); project.addEntity(entity); sendProject(); return project.snapshot() })
ipcMain.handle('project:remove-entity', (_, id) => { requireProject(); project.removeEntity(id); sendProject(); return project.snapshot() })
ipcMain.handle('project:clear-entities', (_, id) => { requireProject(); project.clearEntities(id); sendProject(); return project.snapshot(activePage, pageSize) })
ipcMain.handle('project:delete-document', (_, id) => { requireProject(); project.deleteDocument(id); sendProject(); return project.snapshot(activePage, pageSize) })
ipcMain.handle('project:set-status', (_, id, status) => { requireProject(); project.setStatus(id, status); sendProject(); return project.snapshot() })
ipcMain.handle('settings:set-key', (_, key) => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Encrypted storage is unavailable on this computer.'); writeSettings({ ...readSettings(), openaiKey: safeStorage.encryptString(key).toString('base64') }); return true })
ipcMain.handle('settings:has-key', () => Boolean(readSettings().openaiKey))
ipcMain.handle('settings:get-model', () => readSettings().openaiModel || readSettings().model || 'gpt-5-mini')
ipcMain.handle('settings:set-model', (_, model) => { if (typeof model !== 'string' || !model.trim()) throw new Error('Choose a valid OpenAI model.'); writeSettings({ ...readSettings(), openaiModel: model }); return model })
ipcMain.handle('settings:set-gemini-key', (_, key) => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Encrypted storage is unavailable on this computer.'); writeSettings({ ...readSettings(), geminiKey: safeStorage.encryptString(key).toString('base64') }); return true })
ipcMain.handle('settings:set-provider', (_, provider) => { if (!['openai', 'gemini', 'local-agent'].includes(provider)) throw new Error('Choose a valid provider.'); writeSettings({ ...readSettings(), provider }); return provider })
ipcMain.handle('settings:get-provider', () => readSettings().provider || 'openai')
ipcMain.handle('settings:get-gemini-model', () => readSettings().geminiModel || 'gemini-2.5-flash')
ipcMain.handle('settings:set-gemini-model', (_, model) => { if (typeof model !== 'string' || !model.startsWith('gemini-')) throw new Error('Choose a valid Gemini model.'); writeSettings({ ...readSettings(), geminiModel: model }); return model })
ipcMain.handle('settings:get-local-agent', () => readSettings().localAgent || 'codex')
ipcMain.handle('settings:set-local-agent', async (_, agent) => { if (!AGENT_PROFILES[agent]) throw new Error('Choose a supported local coding agent.'); const settings = readSettings(); if (settings.localAgent && settings.localAgent !== agent) await restartLocalAgent(settings.localAgent); writeSettings({ ...settings, localAgent: agent }); return agent })
ipcMain.handle('settings:get-local-agent-model', () => readSettings().localAgentModel || '')
ipcMain.handle('settings:set-local-agent-model', (_, model) => { if (typeof model !== 'string' || model.length > 200) throw new Error('Choose a valid local agent model override.'); writeSettings({ ...readSettings(), localAgentModel: model.trim() }); return model.trim() })
ipcMain.handle('settings:get-ai-prompt', () => readSettings().aiPrompt || '')
ipcMain.handle('settings:set-ai-prompt', (_, prompt) => { if (typeof prompt !== 'string' || prompt.length > 10_000) throw new Error('Custom AI instructions must be text under 10,000 characters.'); writeSettings({ ...readSettings(), aiPrompt: prompt }); return prompt })
ipcMain.handle('ai:list-models', async () => { const cipher = readSettings().openaiKey; if (!cipher) throw new Error('Save an OpenAI API key before loading models.'); const client = new OpenAI({ apiKey: safeStorage.decryptString(Buffer.from(cipher, 'base64')) }); let page = await client.models.list(); const models = [...page.data]; while (page.hasNextPage()) { page = await page.getNextPage(); models.push(...page.data) } return models.map((model) => model.id).sort((a, b) => a.localeCompare(b)) })
ipcMain.handle('ai:local-agents', () => discoverLocalAgents())
ipcMain.handle('ai:local-agent-models', (_, agent) => listLocalAgentModels(agent))
ipcMain.handle('ai:local-agent-runtime', (_, agent) => { if (!AGENT_PROFILES[agent]) throw new Error('Choose a supported local coding agent.'); return acpRuntimeStatus(agent) })
ipcMain.handle('ai:restart-local-agent', (_, agent) => restartLocalAgent(agent))
ipcMain.handle('ai:clear-local-agent-context', (_, agent) => clearLocalAgentContext(agent))
ipcMain.handle('project:export', async (_, reviewedOnly) => { requireProject(); const choice = await dialog.showSaveDialog(win, { defaultPath: 'dataset.jsonl', filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }] }); if (choice.canceled || !choice.filePath) return null; const count = project.exportJsonl(choice.filePath, reviewedOnly); return { count, path: choice.filePath } })
ipcMain.handle('ai:suggest', async (_, document) => {
  requireProject()
  const canonicalDocument = project.getDocument(document.id)
  if (!canonicalDocument) throw new Error('This document no longer exists.')
  const data = project.snapshot()
  return suggestEntities({
    documentText: canonicalDocument.text,
    labels: data.labels,
    settings: readSettings(),
    decryptKey: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  })
})
