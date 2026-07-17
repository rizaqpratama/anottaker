import type { RawSuggestionEntity } from '@nertator/shared'
import { OPENAI_NER_JSON_SCHEMA } from './schema'

export type AiCallResult = {
  entities: RawSuggestionEntity[]
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }
}

export async function suggestWithOpenAI({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}: {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
}): Promise<AiCallResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: OPENAI_NER_JSON_SCHEMA },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 300)}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenAI returned no content.')

  const parsed = JSON.parse(content) as { entities: RawSuggestionEntity[] }
  const usage = data.usage || {}
  return {
    entities: parsed.entities,
    usage: {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    },
  }
}

export async function listOpenAiModels(apiKey: string): Promise<string[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) throw new Error(`Could not load OpenAI models (${response.status}).`)
  const data = await response.json()
  return (data.data as { id: string }[]).map((m) => m.id).sort((a, b) => a.localeCompare(b))
}
