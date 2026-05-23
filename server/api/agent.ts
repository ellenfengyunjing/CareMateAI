import { Router } from 'express'
import { z } from 'zod'
import { createAgentPlan } from '../agents/careAgent.js'
import { executeTool } from '../tools/executor.js'
import { healthPlanSchema } from '../tools/healthPlan.js'
import { AppError } from '../lib/httpError.js'

export const agentRouter = Router()

const userSettingsSchema = z.object({
  userName: z.string().default('陈林夕'),
  leaderName: z.string().default('Ellen Feng'),
  leaderOpenId: z.string().optional(),
  homeAddress: z.string().default('深圳市南山区科技园'),
  emergencyContactName: z.string().default('Sarah Miller'),
  emergencyPhone: z.string().default('13800000000'),
})

const planSchema = z.object({
  text: z.string().min(1).max(1000),
  settings: userSettingsSchema.partial().default({}),
})

const executeWorkflowSchema = z.object({
  plan: healthPlanSchema,
  settings: userSettingsSchema.partial().default({}),
})

agentRouter.post('/plan', async (req, res, next) => {
  try {
    const parsed = planSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_AGENT_PLAN_REQUEST', '请输入有效的用户语音文本')
    }

    const settings = userSettingsSchema.parse(parsed.data.settings)
    const plan = await createAgentPlan({
      text: parsed.data.text,
      settings,
    })

    res.json({
      success: true,
      plan,
      assistantMessage: plan.assistantMessage,
    })
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

    const settings = userSettingsSchema.parse(parsed.data.settings)
    const { plan } = parsed.data
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
          receiver: settings.leaderName,
          receiver_open_id: settings.leaderOpenId,
          message_text:
            plan.leaveMessageText ||
            `${settings.leaderName}，我今天身体不太舒服，想先请一天病假休息观察一下。手头紧急事项我会尽量线上同步，谢谢理解。`,
        }),
      )
    }

    if (plan.suggestedTools.includes('search_nearby_clinic')) {
      results.push(
        await executeTool('search_nearby_clinic', {
          location: settings.homeAddress,
          severity: plan.severity,
          symptom_summary: plan.summary,
        }),
      )
    }

    if (plan.suggestedTools.includes('send_sms_emergency') || plan.intent === 'emergency') {
      results.push(
        await executeTool('send_sms_emergency', {
          phone_number: settings.emergencyPhone,
          message: `CareMate提醒：${settings.userName} 当前状态为 ${plan.severity} 风险。${plan.summary}，建议尽快联系并确认安全。`,
        }),
      )
    }

    res.json({ success: true, results })
  } catch (error) {
    next(error)
  }
})
