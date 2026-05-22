import express from 'express'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import { leaveRouter } from './api/leave.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: 'RATE_LIMITED',
      message: '请求过于频繁，请稍后再试',
    },
  }),
)

app.get('/api/health', (_req, res) => {
  res.json({ success: true, service: 'CareMate API' })
})

app.use('/api/leave', leaveRouter)
app.use(errorHandler)

app.listen(env.PORT, () => {
  console.log(`CareMate API listening on http://localhost:${env.PORT}`)
})
