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

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
)

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
)

const envSchema = z.object({
  FEISHU_APP_ID: optionalNonEmptyString,
  FEISHU_APP_SECRET: optionalNonEmptyString,
  VOICE_PROVIDER: z.enum(['openai', 'volcengine']).default('openai'),
  VOLCENGINE_ASR_APP_KEY: optionalNonEmptyString,
  VOLCENGINE_ASR_RESOURCE_ID: z.string().default('volc.seedasr.sauc.duration'),
  VOLCENGINE_ASR_ENDPOINT: z.string().default('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-5'),
  OPENAI_FALLBACK_MODELS: z.string().default('gpt-5.2,gpt-5.1,gpt-5'),
  OPENAI_BASE_URL: optionalUrl,
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime'),
  AGENT_LOCAL_FALLBACK: booleanEnv.default(false),
  FEISHU_MOCK: booleanEnv.default(false),
  MAESTRO_ENABLED: booleanEnv.default(false),
  MAESTRO_DRY_RUN: booleanEnv.default(true),
  MAESTRO_CLI_PATH: z.string().default('maestro'),
  MAESTRO_FLOW_DIR: z.string().default('data/maestro/flows'),
  TENCENT_MAP_KEY: optionalNonEmptyString,
  PORT: z.coerce.number().int().positive().default(8787),
})

export const env = envSchema.parse(process.env)
