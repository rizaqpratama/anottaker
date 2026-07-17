import type { RawSuggestionEntity } from '@nertator/shared'
import { GEMINI_NER_RESPONSE_SCHEMA } from './schema'
import type { AiCallResult } from './openai'

export async function suggestWithGemini({
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_NER_RESPONSE_SCHEMA,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 300)}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned no content.')

  const parsed = JSON.parse(text) as { entities: RawSuggestionEntity[] }
  const usage = data.usageMetadata || {}
  return {
    entities: parsed.entities,
    usage: {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      cachedInputTokens: usage.cachedContentTokenCount ?? 0,
    },
  }
}
