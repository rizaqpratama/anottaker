const { ChatOpenAI } = require('@langchain/openai')
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai')
const { z } = require('zod')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { invokeLocalAgent } = require('./local-agent.cjs')

const REQUEST_TIMEOUT_MS = 60_000

function logAi(event, payload) {
  console.info(`\n[NERTator AI] ${event}\n${JSON.stringify(payload, null, 2)}`)
}

function parsePricingCsv(csv) {
  const [header, ...rows] = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const fields = header.split(',')
  return new Map(rows.map((row) => {
    const values = row.split(',')
    const entry = Object.fromEntries(fields.map((field, index) => [field, values[index]?.trim() || '']))
    return [entry.item, {
      input: Number(entry.input),
      cachedInput: entry.cached_input && entry.cached_input !== '-' ? Number(entry.cached_input) : null,
      // Some supplied rows omit the trailing output field and place that rate in cache_write.
      output: Number(entry.output || entry.cache_write),
    }]
  }).filter(([model, pricing]) => model && Number.isFinite(pricing.input) && Number.isFinite(pricing.output)))
}

function loadPricingTable() {
  const candidates = [
    path.join(__dirname, '../data/pricing.csv'),
    path.join(__dirname, 'data/pricing.csv'),
  ]
  const pricingPath = candidates.find((candidate) => fs.existsSync(candidate))
  return pricingPath ? parsePricingCsv(fs.readFileSync(pricingPath, 'utf8')) : new Map()
}

const pricingTable = loadPricingTable()

const entitySchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string().min(1),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict()

const nerResponseSchema = z.object({
  entities: z.array(entitySchema),
}).strict()

const NER_SYSTEM_PROMPT = `You are a precise named-entity recognition assistant for dataset annotation.

Only annotate labels supplied by the user. For each label, return at most one candidate: the highest-confidence match only. Omit labels with no confident match.

Every entity must use zero-based character offsets into the source text. The text field must exactly equal sourceText.slice(start, end), preserving all spaces and punctuation. Never infer or normalize text. Return no overlapping entities.`

function buildNerPrompt(documentText, labels) {
  return JSON.stringify({
    labels: labels.map(({ name, description }) => ({ name, description: description || '' })),
    sourceText: documentText,
  })
}

function buildSystemPrompt(customInstructions = '') {
  const instructions = customInstructions.trim()
  return instructions ? `${NER_SYSTEM_PROMPT}\n\nAdditional project instructions:\n${instructions}` : NER_SYSTEM_PROMPT
}

function getUsage(raw) {
  const usage = raw?.usage_metadata || raw?.response_metadata?.usage || raw?.response_metadata?.usageMetadata || {}
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0,
    cachedInputTokens: usage.input_token_details?.cache_read ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cachedContentTokenCount ?? 0,
  }
}

function estimateCost(model, usage) {
  const pricing = pricingTable.get(model)
  if (!pricing) return null

  const cachedInputTokens = Math.min(usage.inputTokens, usage.cachedInputTokens || 0)
  const standardInputTokens = usage.inputTokens - cachedInputTokens
  const inputCost = ((standardInputTokens * pricing.input) + (cachedInputTokens * (pricing.cachedInput ?? pricing.input))) / 1_000_000
  return inputCost + (usage.outputTokens * pricing.output) / 1_000_000
}

function closestTextOffset(documentText, text, expectedStart) {
  const matches = []
  for (let start = documentText.indexOf(text); start >= 0; start = documentText.indexOf(text, start + 1)) matches.push(start)
  if (!matches.length) return null
  return matches.sort((a, b) => Math.abs(a - expectedStart) - Math.abs(b - expectedStart))[0]
}

function validateSuggestions(documentText, labels, entities) {
  const labelsByLowerName = new Map(labels.map((label) => [label.name.toLowerCase(), label.name]))
  const normalized = []

  for (const entity of entities) {
    const label = labelsByLowerName.get(entity.label.toLowerCase())
    if (!label) continue

    let start = entity.start
    let end = entity.end
    // Providers sometimes return an offset that is off by one. The exact entity text is
    // authoritative only when it occurs in the source document, nearest to the given offset.
    if (end > documentText.length || start >= end || documentText.slice(start, end) !== entity.text) {
      start = closestTextOffset(documentText, entity.text, entity.start)
      if (start === null) continue
      end = start + entity.text.length
    }
    normalized.push({ ...entity, label, start, end })
  }

  const accepted = []
  const usedLabels = new Set()
  for (const entity of normalized.sort((a, b) => b.confidence - a.confidence)) {
    if (usedLabels.has(entity.label)) continue
    if (accepted.some((item) => entity.start < item.end && entity.end > item.start)) continue
    usedLabels.add(entity.label)
    accepted.push({ ...entity, id: randomUUID() })
  }

  return accepted.sort((a, b) => a.start - b.start)
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
