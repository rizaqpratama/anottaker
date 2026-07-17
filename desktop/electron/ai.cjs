const { ChatOpenAI } = require('@langchain/openai')
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai')
const { invokeLocalAgent } = require('./local-agent.cjs')
const {
  NER_SYSTEM_PROMPT,
  buildNerPrompt,
  buildSystemPrompt,
  validateSuggestions,
  nerResponseSchema,
  parsePricingCsv,
  estimateCost: estimateCostFromTable,
  loadPricingTable,
} = require('@nertator/shared')

const REQUEST_TIMEOUT_MS = 60_000

function logAi(event, payload) {
  console.info(`\n[NERTator AI] ${event}\n${JSON.stringify(payload, null, 2)}`)
}

// data/pricing.csv now lives only in shared/ (single source of truth, embedded
// into @nertator/shared's build so RN can use it with no filesystem access);
// loadPricingTable() here just parses that embedded copy.
const pricingTable = loadPricingTable()

function estimateCost(model, usage) {
  return estimateCostFromTable(pricingTable, model, usage)
}

function getUsage(raw) {
  const usage = raw?.usage_metadata || raw?.response_metadata?.usage || raw?.response_metadata?.usageMetadata || {}
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0,
    cachedInputTokens: usage.input_token_details?.cache_read ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cachedContentTokenCount ?? 0,
  }
}

function providerModel(settings, decryptKey) {
  if (settings.provider === 'gemini') {
    if (!settings.geminiKey) throw new Error('Add a Gemini API key in AI settings.')
    return {
      model: settings.geminiModel || 'gemini-2.5-flash',
      chatModel: new ChatGoogleGenerativeAI({
        apiKey: decryptKey(settings.geminiKey),
        model: settings.geminiModel || 'gemini-2.5-flash',
        temperature: 0,
        timeout: REQUEST_TIMEOUT_MS,
      }),
    }
  }

  if (!settings.openaiKey) throw new Error('Add an OpenAI API key in AI settings.')
  return {
    model: settings.openaiModel || settings.model || 'gpt-5-mini',
    chatModel: new ChatOpenAI({
      apiKey: decryptKey(settings.openaiKey),
      model: settings.openaiModel || settings.model || 'gpt-5-mini',
      temperature: 0,
      timeout: REQUEST_TIMEOUT_MS,
    }),
  }
}

async function suggestEntities({ documentText, labels, settings, decryptKey }) {
  const started = Date.now()
  const userPrompt = buildNerPrompt(documentText, labels)
  const systemPrompt = buildSystemPrompt(settings.aiPrompt || '')
  if (settings.provider === 'local-agent') {
    const agentId = settings.localAgent || 'codex'
    const modelOverride = settings.localAgentModel || ''
    const model = `${agentId}${modelOverride ? ` · ${modelOverride}` : ' · default model'}`
    logAi('Request', { provider: 'local-agent', agent: agentId, model, timeoutMs: REQUEST_TIMEOUT_MS, systemPrompt, userPayload: JSON.parse(userPrompt) })
    try {
      const response = await invokeLocalAgent({ agentId, model: modelOverride, systemPrompt, userPrompt })
      const parsed = nerResponseSchema.parse(response.parsed)
      const suggestions = validateSuggestions(documentText, labels, parsed.entities)
      const stats = { provider: 'local-agent', model: `${response.profile.name}${modelOverride ? ` · ${modelOverride}` : ' · default model'}`, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usageAvailable: false, elapsedMs: Date.now() - started, estimatedCost: null }
      if (response.raw?.timing) logAi('ACP timing', { agent: agentId, model: stats.model, ...response.raw.timing, elapsedMs: stats.elapsedMs })
      logAi('Response', { parsed, raw: response.raw, suggestions, stats })
      return { suggestions, stats }
    } catch (error) {
      logAi('Request failed', { provider: 'local-agent', agent: agentId, model, elapsedMs: Date.now() - started, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack, rawAgentResponse: error.rawAgentResponse } : error })
      throw error
    }
  }

  const { model, chatModel } = providerModel(settings, decryptKey)
  const extractor = chatModel.withStructuredOutput(nerResponseSchema, {
    name: 'ner_entity_suggestions',
    strict: true,
    includeRaw: true,
  })
  logAi('Request', {
    provider: settings.provider || 'openai',
    model,
    timeoutMs: REQUEST_TIMEOUT_MS,
    systemPrompt,
    userPayload: JSON.parse(userPrompt),
  })

  try {
    const response = await extractor.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])
    const parsed = response.parsed || response
    const usage = getUsage(response.raw)
    const suggestions = validateSuggestions(documentText, labels, parsed.entities || [])
    const stats = { provider: settings.provider || 'openai', model, ...usage, usageAvailable: true, elapsedMs: Date.now() - started, estimatedCost: estimateCost(model, usage) }
    logAi('Response', { parsed, raw: response.raw, suggestions, stats })
    return { suggestions, stats }
  } catch (error) {
    logAi('Request failed', {
      provider: settings.provider || 'openai',
      model,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
    })
    throw error
  }
}

module.exports = { NER_SYSTEM_PROMPT, buildNerPrompt, buildSystemPrompt, estimateCost, parsePricingCsv, suggestEntities, validateSuggestions }
