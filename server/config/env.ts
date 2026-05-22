import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  FEISHU_APP_ID: z.string().min(1, 'FEISHU_APP_ID is required'),
  FEISHU_APP_SECRET: z.string().min(1, 'FEISHU_APP_SECRET is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  PORT: z.coerce.number().int().positive().default(8787),
})

export const env = envSchema.parse(process.env)

