import { Router } from 'express'
import { z } from 'zod'
import { executeTool } from '../tools/executor.js'
import { AppError } from '../lib/httpError.js'

export const toolsRouter = Router()

const executeToolSchema = z.object({
  name: z.string().min(1),
  arguments: z.unknown().default({}),
})

toolsRouter.post('/execute', async (req, res, next) => {
  try {
    const parsed = executeToolSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_TOOL_REQUEST', '工具调用参数不正确')
    }

    const result = await executeTool(parsed.data.name, parsed.data.arguments)
    res.json({
      success: result.success,
      result,
    })
  } catch (error) {
    next(error)
  }
})

