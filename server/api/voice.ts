import { Router } from 'express'
import { env } from '../config/env.js'

export const voiceRouter = Router()

voiceRouter.get('/status', (_req, res) => {
  const volcengineConfigured = Boolean(env.VOLCENGINE_ASR_APP_KEY)
  res.json({
    success: true,
    provider: env.VOICE_PROVIDER,
    ready: env.VOICE_PROVIDER === 'openai' || volcengineConfigured,
    volcengine: {
      asrConfigured: volcengineConfigured,
      endpoint: env.VOLCENGINE_ASR_ENDPOINT,
      resourceId: env.VOLCENGINE_ASR_RESOURCE_ID,
      sampleRate: 16000,
    },
  })
})
