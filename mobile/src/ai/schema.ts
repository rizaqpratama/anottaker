// Hand-rolled JSON Schema mirroring @nertator/shared's Zod nerResponseSchema, since
// the two providers' REST structured-output features want a JSON Schema, not a Zod
// schema. Keep this in sync with shared/src/ai/schema.ts if that shape ever changes.

export const OPENAI_NER_JSON_SCHEMA = {
  name: 'ner_entity_suggestions',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            start: { type: 'integer', minimum: 0 },
            end: { type: 'integer', minimum: 0 },
            text: { type: 'string', minLength: 1 },
            label: { type: 'string', minLength: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['start', 'end', 'text', 'label', 'confidence'],
        },
      },
    },
    required: ['entities'],
  },
} as const

// Gemini's response_schema is a JSON-Schema subset with no additionalProperties support.
export const GEMINI_NER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'integer' },
          end: { type: 'integer' },
          text: { type: 'string' },
          label: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['start', 'end', 'text', 'label', 'confidence'],
      },
    },
  },
  required: ['entities'],
} as const
