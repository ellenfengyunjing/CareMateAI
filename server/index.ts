import express from 'express'
import { createServer } from 'node:http'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import { leaveRouter } from './api/leave.js'
import { toolsRouter } from './api/tools.js'
import { agentRouter } from './api/agent.js'
import { errorHandler } from './middleware/errorHandler.js'
import { attachRealtimeServer } from './realtime/server.js'

const app = express()
const server = createServer(app)

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 40,
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
app.use('/api/tools', toolsRouter)
app.use('/api/agent', agentRouter)
app.use(errorHandler)

attachRealtimeServer(server)

server.listen(env.PORT, () => {
  console.log(`CareMate API listening on http://localhost:${env.PORT}`)
  console.log(`Realtime WebSocket listening on ws://localhost:${env.PORT}/ws/realtime`)
})
