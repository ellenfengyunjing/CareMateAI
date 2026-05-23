import 'dotenv/config'
import { z } from 'zod'

const booleanEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') return value
    if (!value) return undefined
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  })

const envSchema = z.object({
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime'),
  FEISHU_MOCK: booleanEnv.default(false),
  SMS_MOCK: booleanEnv.default(true),
  PORT: z.coerce.number().int().positive().default(8787),
})

export const env = envSchema
  .superRefine((value, context) => {
    if (!value.FEISHU_MOCK && (!value.FEISHU_APP_ID || !value.FEISHU_APP_SECRET)) {
      context.addIssue({
        code: 'custom',
        message: 'FEISHU_APP_ID and FEISHU_APP_SECRET are required when FEISHU_MOCK=false',
        path: ['FEISHU_APP_ID'],
      })
    }
  })
  .parse(process.env)
