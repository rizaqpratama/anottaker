import { z } from 'zod'

export const entitySchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string().min(1),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict()

export const nerResponseSchema = z.object({
  entities: z.array(entitySchema),
}).strict()
