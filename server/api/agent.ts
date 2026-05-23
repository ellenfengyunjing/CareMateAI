import { Router } from 'express'
import { z } from 'zod'
import { createLocalHealthPlan } from '../tools/healthPlan.js'
import { executeTool } from '../tools/executor.js'
import { AppError } from '../lib/httpError.js'

export const agentRouter = Router()

const planSchema = z.object({
  text: z.string().min(1).max(1000),
})

const executeWorkflowSchema = z.object({
  plan: z.object({
    intent: z.enum(['health_check', 'leave_request', 'emergency', 'daily_help']),
    severity: z.enum(['low', 'medium', 'high']),
    summary: z.string(),
    todos: z.array(z.string()),
    recommendedActions: z.array(z.string()),
    requiresConfirmation: z.boolean(),
    suggestedTools: z.array(z.string()),
  }),
  leaderName: z.string().default('Ellen Feng'),
  homeAddress: z.string().default('深圳市南山区科技园'),
  emergencyPhone: z.string().default('13800000000'),
})

agentRouter.post('/plan', (req, res, next) => {
  try {
    const parsed = planSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_AGENT_PLAN_REQUEST', '请输入有效的用户语音文本')
    }

    const plan = createLocalHealthPlan(parsed.data.text)
    res.json({ success: true, plan })
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/execute', async (req, res, next) => {
  try {
    const parsed = executeWorkflowSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_AGENT_EXECUTE_REQUEST', '执行参数不正确')
    }

    const { plan, leaderName, homeAddress, emergencyPhone } = parsed.data
    const results = []

    results.push(
      await executeTool('create_todo_list', {
        todos: plan.todos,
        intent: {
          intent: plan.intent,
          severity: plan.severity,
          summary: plan.summary,
          todos: plan.todos,
        },
      }),
    )

    if (plan.suggestedTools.includes('send_feishu_message')) {
      results.push(
        await executeTool('send_feishu_message', {
          receiver: leaderName,
          message_text: `Ellen，我今天发烧头晕，身体状态不太适合到公司，想先请一天病假休息观察一下。手头紧急事项我会尽量线上同步，如果有特别急的事情可以电话联系我。谢谢理解。`,
        }),
      )
    }

    if (plan.suggestedTools.includes('search_nearby_clinic')) {
      results.push(
        await executeTool('search_nearby_clinic', {
          location: homeAddress,
          severity: plan.severity,
          symptom_summary: plan.summary,
        }),
      )
    }

    if (plan.intent === 'emergency') {
      results.push(
        await executeTool('send_sms_emergency', {
          phone_number: emergencyPhone,
          message: `CareMate提醒：用户当前状态为${plan.severity}风险。${plan.summary}，建议尽快联系并确认安全。`,
        }),
      )
    }

    res.json({ success: true, results })
  } catch (error) {
    next(error)
  }
})

