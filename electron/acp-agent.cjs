const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Readable, Writable } = require('node:stream')

const ACP_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 1_000_000
const ACP_AGENT_IDS = new Set(['codex', 'claude', 'opencode'])
const packageBins = {
  codex: { packageName: '@agentclientprotocol/codex-acp', bin: 'codex-acp' },
  claude: { packageName: '@agentclientprotocol/claude-agent-acp', bin: 'claude-agent-acp' },
}
const runtimes = new Map()

function appendOutput(current, chunk) { return `${current}${chunk}`.slice(-MAX_OUTPUT_BYTES) }

function bundledBin(agentId) {
  const spec = packageBins[agentId]
  if (!spec) return null
  const packagePath = require.resolve(`${spec.packageName}/package.json`)
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const relative = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[spec.bin]
  if (!relative) throw new Error(`The bundled ${spec.bin} ACP adapter has no executable entrypoint.`)
  return path.resolve(path.dirname(packagePath), relative)
}

function resolveExecutable(executable, pathValue = process.env.PATH || '', platform = process.platform) {
  const extensions = platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`)
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate } catch { /* continue */ }
    }
  }
  return null
}

function buildAcpCommand(agentId, workspace, executablePath) {
  if (!ACP_AGENT_IDS.has(agentId)) throw new Error('Choose an ACP-enabled local agent.')
  if (agentId === 'opencode') {
    return { executable: executablePath, args: ['acp', '--pure', '--cwd', workspace], env: { OPENCODE_PERMISSION: '{"*":"deny"}', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true' } }
  }
  const adapter = bundledBin(agentId)
  return {
    executable: process.execPath,
    args: [adapter],
    // Electron's executable must run adapter entrypoints as Node, otherwise it
    // would try to start another Electron application rather than a stdio server.
    env: { ELECTRON_RUN_AS_NODE: '1', ...(agentId === 'codex' ? { INITIAL_AGENT_MODE: 'read-only' } : {}) },
  }
}

function formatAcpPrompt(systemPrompt, userPrompt) {
  return `TASK: Perform named-entity annotation only. This is a one-shot data task, not a coding task. Do not plan, inspect your environment, call tools, read files, or modify files.\n\n${systemPrompt}\n\nDataset input:\n${userPrompt}\n\nReturn only valid JSON matching {"entities":[{"start":number,"end":number,"text":string,"label":string,"confidence":number}]}. Return the JSON object and nothing else.`
}

function permissionDenied() { return { outcome: { outcome: 'cancelled' } } }

function configValues(option) {
  return (option?.options || []).flatMap((item) => Array.isArray(item.options) ? item.options : [item])
}

async function applyModelOverride(context, session, model, acp) {
  const requested = model?.trim()
  if (!requested) return false
  const option = (session.newSessionResponse.configOptions || []).find((item) => item.category === 'model' && item.type === 'select')
  if (!option) throw new Error(`This ${session.newSessionResponse._meta?.agentName || 'ACP'} agent does not expose a selectable model for the requested override '${requested}'.`)
  const value = configValues(option).find((item) => item.value === requested || item.name === requested)
  if (!value) throw new Error(`The requested model '${requested}' is not available from this ACP agent.`)
  await context.request(acp.methods.agent.session.setConfigOption, { sessionId: session.sessionId, configId: option.id, value: value.value })
  return true
}

function isAlive(runtime) { return runtime?.child.exitCode === null && !runtime.child.killed && !runtime.connection?.signal?.aborted }

async function loadAcp() { return import('@agentclientprotocol/sdk') }

async function startAcpRuntime({ agentId, executablePath, profile }) {
  const current = runtimes.get(agentId)
  if (isAlive(current)) return current
  if (current) await stopAcpRuntime(agentId)

  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), `nertator-acp-${agentId}-`))
  const command = buildAcpCommand(agentId, workspace, executablePath)
  const child = spawn(command.executable, command.args, {
    cwd: workspace,
    env: { ...process.env, ...command.env },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const runtime = { agentId, profile, workspace, child, stdout: '', stderr: '', connection: null, context: null, initialized: false, queue: Promise.resolve(), stopped: false, command: { executable: command.executable, args: command.args } }
  child.stdout.on('data', (chunk) => { runtime.stdout = appendOutput(runtime.stdout, chunk.toString()) })
  child.stderr.on('data', (chunk) => { runtime.stderr = appendOutput(runtime.stderr, chunk.toString()) })
  child.on('exit', () => { runtime.initialized = false; runtime.connection?.close(new Error(`${profile.name} ACP process exited.`)) })
  runtimes.set(agentId, runtime)

  try {
    const acp = await loadAcp()
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
    const app = acp.client({ name: 'NERTator' })
      .onRequest(acp.methods.client.session.requestPermission, () => permissionDenied())
    runtime.connection = app.connect(stream)
    runtime.context = runtime.connection.agent
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      await runtime.context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'NERTator', version: '1.0.0' },
      }, { cancellationSignal: controller.signal })
      runtime.initialized = true
      return runtime
    } finally { clearTimeout(timer) }
  } catch (error) {
    if (error instanceof Error) error.rawAgentResponse = { stdout: runtime.stdout, stderr: runtime.stderr, persistent: true, acp: true, command: runtime.command }
    await stopAcpRuntime(agentId)
    throw error
  }
}

async function stopAcpRuntime(agentId) {
  const runtime = runtimes.get(agentId)
  if (!runtime) return
  runtimes.delete(agentId)
  runtime.stopped = true
  runtime.connection?.close(new Error('NERTator closed the ACP agent.'))
  if (runtime.child.exitCode === null && !runtime.child.killed) runtime.child.kill('SIGTERM')
  await fsp.rm(runtime.workspace, { recursive: true, force: true })
}

async function shutdownAcpAgents() { await Promise.all([...runtimes.keys()].map(stopAcpRuntime)) }

function acpRuntimeStatus(agentId) {
  const runtime = runtimes.get(agentId)
  if (!runtime) return { agentId, state: 'stopped' }
  if (isAlive(runtime) && runtime.initialized) return { agentId, state: 'ready', workspace: runtime.workspace, command: runtime.command }
  return { agentId, state: 'starting', workspace: runtime.workspace, command: runtime.command }
}

async function invokeAcpAgent({ agentId, executablePath, profile, model, systemPrompt, userPrompt }) {
  if (!ACP_AGENT_IDS.has(agentId)) throw new Error('Choose an ACP-enabled local agent.')
  const runtime = await startAcpRuntime({ agentId, executablePath, profile })
  const execute = async () => {
    const acp = await loadAcp()
    const session = await runtime.context.buildSession(runtime.workspace).start()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ACP_TIMEOUT_MS)
    const textParts = []
    try {
      await applyModelOverride(runtime.context, session, model, acp)
      const promptRequest = session.prompt(formatAcpPrompt(systemPrompt, userPrompt), { cancellationSignal: controller.signal })
      for (;;) {
        const update = await session.nextUpdate()
        if (update.kind === 'stop') break
        if (update.update.sessionUpdate === 'agent_message_chunk' && update.update.content?.type === 'text') textParts.push(update.update.content.text)
      }
      await promptRequest
      const stdout = textParts.join('')
      if (!stdout.trim()) throw new Error('ACP agent completed without a text response.')
      return { stdout, stderr: runtime.stderr, persistent: true, acp: true, model: model || null, command: runtime.command }
    } catch (error) {
      if (controller.signal.aborted) {
        runtime.context.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId }).catch(() => {})
        throw new Error(`Local agent timed out after ${Math.round(ACP_TIMEOUT_MS / 1000)} seconds.`)
      }
      throw error
    } finally {
      clearTimeout(timer)
      session.dispose()
      runtime.context.request(acp.methods.agent.session.close, { sessionId: session.sessionId }).catch(() => {})
    }
  }
  const queued = runtime.queue.then(execute, execute)
  runtime.queue = queued.catch(() => {})
  try { return await queued } catch (error) {
    if (error instanceof Error) error.rawAgentResponse = { ...(error.rawAgentResponse || {}), stdout: runtime.stdout, stderr: runtime.stderr, persistent: true, acp: true, command: runtime.command }
    throw error
  }
}

module.exports = { ACP_AGENT_IDS, ACP_TIMEOUT_MS, acpRuntimeStatus, applyModelOverride, buildAcpCommand, bundledBin, formatAcpPrompt, invokeAcpAgent, permissionDenied, resolveExecutable, shutdownAcpAgents, startAcpRuntime, stopAcpRuntime }
