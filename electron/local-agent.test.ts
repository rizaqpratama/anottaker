import { describe, expect, it } from 'vitest'
import localAgent from './local-agent.cjs'
import acpAgent from './acp-agent.cjs'

const { agyPromptTransportForVersion, buildAgentCommand, formatAgentPrompt, isCursorAgentHelp, parseAgentResponse } = localAgent as {
  agyPromptTransportForVersion: (version: string) => 'stdin' | 'argument'
  buildAgentCommand: (agent: string, options: { workspace: string; model?: string; prompt?: string; agyPromptTransport?: 'stdin' | 'argument' }) => { args: string[]; env?: Record<string, string> }
  formatAgentPrompt: (systemPrompt: string, userPrompt: string) => string
  isCursorAgentHelp: (help: string) => boolean
  parseAgentResponse: (output: string) => { entities: Array<{ text: string }> }
}

describe('local coding agent adapters', () => {
  it('builds restricted direct one-shot commands', () => {
    const cursor = buildAgentCommand('cursor', { workspace: '/tmp/empty' })
    expect(cursor.args).toEqual(expect.arrayContaining(['--print', '--output-format', 'json', '--mode', 'ask', '--sandbox', 'enabled', '--trust', '--workspace', '/tmp/empty']))
    expect(() => buildAgentCommand('codex', { workspace: '/tmp/empty' })).toThrow('persistent ACP adapter')
  })

  it('builds bundled and native ACP commands with an isolated workspace', () => {
    const codex = acpAgent.buildAcpCommand('codex', '/tmp/nertator-acp', '')
    const claude = acpAgent.buildAcpCommand('claude', '/tmp/nertator-acp', '')
    const opencode = acpAgent.buildAcpCommand('opencode', '/tmp/nertator-acp', '/usr/local/bin/opencode')
    expect(codex.args[0]).toContain('codex-acp')
    expect(claude.args[0]).toContain('claude-agent-acp')
    expect(codex.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', INITIAL_AGENT_MODE: 'read-only' })
    expect(claude.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1' })
    expect(opencode.args).toEqual(['acp', '--pure', '--cwd', '/tmp/nertator-acp'])
    expect(opencode.env).toMatchObject({ OPENCODE_PERMISSION: '{"*":"deny"}' })
    expect(acpAgent.permissionDenied()).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  it('uses Agy’s version-specific print-mode prompt transport', () => {
    const agy = buildAgentCommand('agy', { workspace: '/tmp/empty', model: 'gemini', prompt: 'NER payload', agyPromptTransport: 'argument' })
    expect(agy.args).toEqual(['--log-file', '/tmp/empty/agy.log', '-p', 'NER payload'])
    expect(agy.args).not.toContain('--mode')
    expect(agy.args).not.toContain('--sandbox')
    expect(agyPromptTransportForVersion('agy 1.0.3')).toBe('stdin')
    expect(agyPromptTransportForVersion('agy 1.1.3')).toBe('argument')
  })

  it('recognizes Cursor Agent and rejects unrelated generic agent binaries', () => {
    expect(isCursorAgentHelp('Start the Cursor Agent\n--output-format <format>\n--mode <mode>')).toBe(true)
    expect(isCursorAgentHelp('Generic agent\n--output-format json')).toBe(false)
  })

  it('extracts structured entities from direct and wrapped JSON output', () => {
    const direct = parseAgentResponse('{"entities":[{"start":0,"end":3,"text":"Ada","label":"PERSON","confidence":0.9}]}')
    const wrapped = parseAgentResponse('{"type":"result","result":"{\\"entities\\":[{\\"start\\":0,\\"end\\":3,\\"text\\":\\"Ada\\",\\"label\\":\\"PERSON\\",\\"confidence\\":0.9}]}"}')
    expect(direct.entities).toHaveLength(1)
    expect(wrapped.entities[0].text).toBe('Ada')
  })

  it('extracts JSON from explanatory text', () => {
    const response = parseAgentResponse('Here is the result:\n{"entities":[{"start":0,"end":3,"text":"Ada","label":"PERSON","confidence":0.9}]}\nDone.')
    expect(response.entities[0].text).toBe('Ada')
  })

  it('keeps the NER payload in stdin prompt content', () => {
    const prompt = formatAgentPrompt('SYSTEM', '{"sourceText":"private record"}')
    expect(prompt).toContain('private record')
    expect(prompt).toContain('Do not plan, inspect your environment, call tools, read files, or modify files.')
  })
})
