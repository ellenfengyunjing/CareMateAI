import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime'),
  FEISHU_MOCK: z.coerce.boolean().default(true),
  SMS_MOCK: z.coerce.boolean().default(true),
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
