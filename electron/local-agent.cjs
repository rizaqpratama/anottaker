const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { ACP_AGENT_IDS, acpRuntimeStatus, bundledBin, invokeAcpAgent, shutdownAcpAgents, stopAcpRuntime } = require('./acp-agent.cjs')

const LOCAL_AGENT_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 1_000_000

const AGENT_PROFILES = {
  codex: { id: 'codex', name: 'Codex', executable: 'codex', loginCommand: 'codex login' },
  claude: { id: 'claude', name: 'Claude Code', executable: 'claude', loginCommand: 'claude login' },
  agy: { id: 'agy', name: 'Google Antigravity', executable: 'agy', loginCommand: 'agy' },
  cursor: { id: 'cursor', name: 'Cursor Agent', executable: 'agent', loginCommand: 'agent login', requiresCursorSignature: true },
  opencode: { id: 'opencode', name: 'OpenCode', executable: 'opencode', loginCommand: 'opencode auth login' },
}

function resolveExecutable(executable, pathValue = process.env.PATH || '', platform = process.platform) {
  const extensions = platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`)
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate } catch { /* keep searching */ }
    }
  }
  return null
}

function runCommand(executable, args, { cwd, input = '', timeoutMs = 5_000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: env ? { ...process.env, ...env } : process.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''; let stderr = ''; let timedOut = false
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT_BYTES)
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString()) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`Local agent timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
      if (code !== 0) {
        const error = new Error((stderr || stdout || `${executable} exited with ${code ?? signal}`).trim())
        error.rawAgentResponse = { stdout, stderr, exitCode: code, signal }
        return reject(error)
      }
      resolve({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}

const OPENCODE_RESTRICTED_ENV = {
  OPENCODE_PERMISSION: '{"*":"deny"}',
  OPENCODE_DISABLE_CLAUDE_CODE: 'true',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
  OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
}

async function shutdownLocalAgents() { await shutdownAcpAgents() }

function isCursorAgentHelp(help) {
  return /Start the Cursor Agent/i.test(help) && /--output-format/i.test(help) && /--mode/i.test(help)
}

async function discoverLocalAgents() {
  const results = []
  for (const profile of Object.values(AGENT_PROFILES)) {
    if (profile.id === 'codex' || profile.id === 'claude') {
      try {
        const executablePath = bundledBin(profile.id)
        results.push({ ...profile, available: true, status: 'Available — bundled persistent ACP adapter', executablePath, version: 'Bundled ACP adapter', transport: 'acp-bundled', runtime: acpRuntimeStatus(profile.id).state })
      } catch (error) {
        results.push({ ...profile, available: false, status: error instanceof Error ? error.message : 'Bundled ACP adapter is unavailable', transport: 'acp-bundled' })
      }
      continue
    }
    const executablePath = resolveExecutable(profile.executable)
    if (!executablePath) { results.push({ ...profile, available: false, status: 'Not found on PATH' }); continue }
    try {
      const [version, help] = await Promise.all([
        runCommand(executablePath, ['--version']),
        runCommand(executablePath, ['--help']),
      ])
      if (profile.requiresCursorSignature && !isCursorAgentHelp(help.stdout)) {
        results.push({ ...profile, available: false, status: 'Found an unrelated agent binary', executablePath }); continue
      }
      results.push({ ...profile, available: true, status: profile.id === 'opencode' ? 'Available — native persistent ACP adapter' : 'Available — uses its existing CLI login', executablePath, version: (version.stdout || version.stderr).trim().split(/\r?\n/)[0] || 'Installed', transport: profile.id === 'opencode' ? 'acp-native' : 'direct', runtime: ACP_AGENT_IDS.has(profile.id) ? acpRuntimeStatus(profile.id).state : undefined })
    } catch (error) {
      results.push({ ...profile, available: false, status: error instanceof Error ? error.message : 'Could not inspect CLI', executablePath })
    }
  }
  return results
}

function agyPromptTransportForVersion(versionOutput = '') {
  const match = versionOutput.match(/\b(\d+)\.(\d+)\.(\d+)\b/)
  if (!match) return 'argument'
  const major = Number(match[1])
  const minor = Number(match[2])
  // OpenDesign verified stdin sentinel support in Agy 1.0.3. Agy 1.1.x
  // instead treats `-` as literal prompt text (see printmode promptLength=1).
  return major === 1 && minor === 0 ? 'stdin' : 'argument'
}

function buildAgentCommand(agentId, { workspace, model, prompt, agyPromptTransport = 'argument' } = {}) {
  const selectedModel = model?.trim()
  if (!AGENT_PROFILES[agentId]) throw new Error('Choose a supported local coding agent.')
  if (ACP_AGENT_IDS.has(agentId)) throw new Error(`${AGENT_PROFILES[agentId].name} uses the persistent ACP adapter, not a one-shot command.`)
  // Agy changed print-mode prompt transport in 1.1: 1.0.x accepts `-` as a
  // stdin sentinel; later versions treat it as the literal prompt. Keep its
  // diagnostic log inside the ephemeral workspace either way.
  if (agentId === 'agy') {
    const logFilePath = path.join(workspace, 'agy.log')
    return { executable: 'agy', args: ['--log-file', logFilePath, '-p', agyPromptTransport === 'stdin' ? '-' : (prompt || '')], logFilePath, promptTransport: agyPromptTransport }
  }
  if (agentId === 'opencode') {
    return {
      executable: 'opencode',
      args: ['--pure', 'run', '--format', 'json', '--dir', workspace, ...(selectedModel ? ['--model', selectedModel] : []), prompt || ''],
      env: {
        // A NER request has no need for tools. Explicit denial prevents the
        // locally configured OpenCode agent from reading or modifying files.
        ...OPENCODE_RESTRICTED_ENV,
      },
    }
  }
  // Cursor requires explicit workspace trust in headless mode. The workspace
  // is an empty directory that NERTator just created for this one request;
  // Cursor remains in its own enabled sandbox and ask/read-only mode.
  return { executable: 'agent', args: ['--print', '--output-format', 'json', '--mode', 'ask', '--sandbox', 'enabled', '--trust', '--workspace', workspace, ...(selectedModel ? ['--model', selectedModel] : [])] }
}

function embeddedJsonCandidates(output) {
  const candidates = []
  let start = -1
  let depth = 0
  let quote = false
  let escaped = false
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quote = false
      continue
    }
    if (character === '"') { quote = true; continue }
    if (character === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (character === '}' && depth) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(output.slice(start, index + 1))
        start = -1
      }
    }
  }
  return candidates
}

function jsonCandidates(output) {
  const candidates = [output.trim()]
  for (const line of output.split(/\r?\n/)) candidates.push(line.trim())
  for (const match of output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1].trim())
  candidates.push(...embeddedJsonCandidates(output))
  return candidates.flatMap((candidate) => { try { return [JSON.parse(candidate)] } catch { return [] } })
}

function findEntities(value) {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value.entities)) return { entities: value.entities }
  for (const nested of Object.values(value)) {
    if (typeof nested === 'string') {
      const result = jsonCandidates(nested).map(findEntities).find(Boolean)
      if (result) return result
    } else {
      const result = findEntities(nested)
      if (result) return result
    }
  }
  return null
}

function parseAgentResponse(output) {
  const parsed = jsonCandidates(output).map(findEntities).find(Boolean)
  if (!parsed) throw new Error('Local agent did not return the required JSON entity response.')
  return parsed
}

function formatAgentPrompt(systemPrompt, userPrompt) {
  return `TASK: Perform named-entity annotation only. This is a one-shot data task, not a coding task. Do not plan, inspect your environment, call tools, read files, or modify files.\n\n${systemPrompt}\n\nDataset input:\n${userPrompt}\n\nReturn only valid JSON matching {"entities":[{"start":number,"end":number,"text":string,"label":string,"confidence":number}]}. Return the JSON object and nothing else.`
}

async function invokeLocalAgent({ agentId, model, systemPrompt, userPrompt }) {
  const profile = AGENT_PROFILES[agentId]
  if (!profile) throw new Error('Choose a supported local coding agent.')
  const executablePath = agentId === 'codex' || agentId === 'claude' ? bundledBin(agentId) : resolveExecutable(profile.executable)
  if (!executablePath) throw new Error(`${profile.name} is not installed. Install it and make sure '${profile.executable}' is on PATH.`)
  if (profile.requiresCursorSignature) {
    const help = await runCommand(executablePath, ['--help'])
    if (!isCursorAgentHelp(help.stdout)) throw new Error("The 'agent' command found on PATH is not Cursor Agent.")
  }
  if (ACP_AGENT_IDS.has(agentId)) {
    try {
      const raw = await invokeAcpAgent({ agentId, executablePath, profile, model, systemPrompt, userPrompt })
      return { profile, parsed: parseAgentResponse(raw.stdout), raw }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/auth|login|sign.?in|unauthori[sz]ed|credential/i.test(message)) {
        const authError = new Error(`${profile.name} is not authenticated. Run '${profile.loginCommand}' in a terminal, then try again.`)
        authError.rawAgentResponse = error?.rawAgentResponse
        throw authError
      }
      throw error
    }
  }
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'nertator-agent-'))
  const prompt = formatAgentPrompt(systemPrompt, userPrompt)
  let agyPromptTransport = 'argument'
  if (agentId === 'agy') {
    const version = await runCommand(executablePath, ['--version']).catch(() => ({ stdout: '' }))
    agyPromptTransport = agyPromptTransportForVersion(version.stdout || version.stderr || '')
  }
  const command = buildAgentCommand(agentId, { workspace, model, prompt, agyPromptTransport })
  try {
    const result = await runCommand(executablePath, command.args, { cwd: workspace, input: command.promptTransport === 'argument' ? '' : prompt, timeoutMs: LOCAL_AGENT_TIMEOUT_MS, env: command.env })
    const safeArgs = command.args.map((argument) => argument === prompt ? `<prompt: ${prompt.length} characters>` : argument)
    const agentLog = command.logFilePath ? await fsp.readFile(command.logFilePath, 'utf8').catch(() => '') : ''
    const raw = { stdout: result.stdout, stderr: result.stderr, agentLog, command: { executable: profile.executable, args: safeArgs, promptTransport: command.promptTransport } }
    try {
      return { profile, parsed: parseAgentResponse(result.stdout), raw }
    } catch (error) {
      error.rawAgentResponse = raw
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && command.logFilePath) {
      const agentLog = await fsp.readFile(command.logFilePath, 'utf8').catch(() => '')
      const safeArgs = command.args.map((argument) => argument === prompt ? `<prompt: ${prompt.length} characters>` : argument)
      error.rawAgentResponse = { ...(error.rawAgentResponse || {}), agentLog, command: { executable: profile.executable, args: safeArgs, promptTransport: command.promptTransport } }
    }
    if (/auth|login|sign.?in|unauthori[sz]ed|credential/i.test(message)) {
      const authError = new Error(`${profile.name} is not authenticated. Run '${profile.loginCommand}' in a terminal, then try again.`)
      authError.rawAgentResponse = error?.rawAgentResponse
      throw authError
    }
    throw error
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true })
  }
}

async function listLocalAgentModels(agentId) {
  if (agentId === 'opencode') {
    const executablePath = resolveExecutable('opencode')
    if (!executablePath) throw new Error('OpenCode is not installed.')
    const output = await runCommand(executablePath, ['models'])
    return [...new Set(output.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[\w.-]+\/[\w./:-]+$/.test(line)))].sort()
  }
  if (agentId !== 'cursor') return []
  const executablePath = resolveExecutable('agent')
  if (!executablePath) throw new Error('Cursor Agent is not installed.')
  const help = await runCommand(executablePath, ['--help'])
  if (!isCursorAgentHelp(help.stdout)) throw new Error("The 'agent' command found on PATH is not Cursor Agent.")
  const output = await runCommand(executablePath, ['--list-models'])
  const values = jsonCandidates(output.stdout).flatMap((item) => Array.isArray(item) ? item : item.models || []).map((item) => typeof item === 'string' ? item : item.id).filter(Boolean)
  return [...new Set(values)].sort()
}

async function restartLocalAgent(agentId) {
  if (!AGENT_PROFILES[agentId]) throw new Error('Choose a supported local coding agent.')
  if (!ACP_AGENT_IDS.has(agentId)) return { agentId, state: 'not-persistent' }
  await stopAcpRuntime(agentId)
  return acpRuntimeStatus(agentId)
}

module.exports = { AGENT_PROFILES, LOCAL_AGENT_TIMEOUT_MS, acpRuntimeStatus, agyPromptTransportForVersion, buildAgentCommand, discoverLocalAgents, findEntities, formatAgentPrompt, invokeLocalAgent, isCursorAgentHelp, listLocalAgentModels, parseAgentResponse, restartLocalAgent, resolveExecutable, shutdownLocalAgents }
