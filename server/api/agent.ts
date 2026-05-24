import { Router } from 'express'
import { z } from 'zod'
import { checkModelConnection, runAgentTurn, type ChatTurn } from '../agents/careAgent.js'
import { executeTool, type ToolExecutionResult } from '../tools/executor.js'
import { healthPlanSchema } from '../tools/healthPlan.js'
import { AppError } from '../lib/httpError.js'
import { mergeWithStoredSettings, userSettingsSchema } from '../settings/store.js'

export const agentRouter = Router()

const chatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
})

const chatRequestSchema = z.object({
  messages: z.array(chatTurnSchema).min(1).max(40),
  settings: userSettingsSchema.partial().default({}),
})

const planRequestSchema = z.object({
  text: z.string().min(1).max(1000),
  settings: userSettingsSchema.partial().default({}),
})

const executeWorkflowSchema = z.object({
  plan: healthPlanSchema,
  tools: z
    .array(
      z.enum([
        'create_todo_list',
        'send_feishu_message',
        'notify_emergency_contact',
        'search_nearby_clinic',
        'route_to_clinic',
        'run_mobile_workflow',
      ]),
    )
    .optional(),
  settings: userSettingsSchema.partial().default({}),
})

function emptyToUndefined(value: string | undefined) {
  return value && value.trim() ? value : undefined
}

agentRouter.get('/model-status', async (_req, res, next) => {
  try {
    const status = await checkModelConnection()
    res.json({ success: true, ...status })
  } catch (error) {
    next(error)
  }
})

agentRouter.post('/chat', async (req, res, next) => {
  try {
    const parsed = chatRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_AGENT_CHAT_REQUEST', '请提供有效的对话历史')
    }

    const settings = await mergeWithStoredSettings(parsed.data.settings)
    const result = await runAgentTurn({
      messages: parsed.data.messages as ChatTurn[],
      settings: {
        userName: settings.userName,
        leaderName: settings.leaderName,
        leaderOpenId: settings.leaderOpenId,
        homeAddress: settings.homeAddress,
        emergencyContactName: settings.emergencyContactName,
        emergencyContactFeishuName: settings.emergencyContactFeishuName,
        emergencyPhone: settings.emergencyPhone,
        allergies: settings.allergies,
        medicalNotes: settings.medicalNotes,
        tencentMapKey: settings.tencentMapKey,
        autoExecute: settings.autoExecute,
      },
    })

    res.json({ success: true, ...result })
  } catch (error) {
    next(error)
  }
})

// Compat: single-turn plan endpoint
agentRouter.post('/plan', async (req, res, next) => {
  try {
    const parsed = planRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_AGENT_PLAN_REQUEST', '请输入有效的用户文本')
    }

    const settings = await mergeWithStoredSettings(parsed.data.settings)
    const agentResult = await runAgentTurn({
      messages: [{ role: 'user', content: parsed.data.text }],
      settings,
    })

    if (agentResult.kind === 'plan') {
      res.json({
        success: true,
        plan: agentResult.plan,
        assistantMessage: agentResult.assistantMessage,
      })
      return
    }

    res.json({
      success: true,
      assistantMessage: agentResult.text,
      plan: {
        intent: 'health_check' as const,
        severity: 'low' as const,
        summary: agentResult.text,
        todos: ['继续补充症状信息'],
        recommendedActions: ['请再说明体温、持续时间、是否胸痛或呼吸困难'],
        requiresConfirmation: false,
        suggestedTools: ['create_todo_list'] as const,
        assistantMessage: agentResult.text,
        leaveMessageText: null,
      },
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

    const settings = await mergeWithStoredSettings(parsed.data.settings)
    const { plan } = parsed.data
    console.log('CareMate workflow execute', {
      intent: plan.intent,
      severity: plan.severity,
      suggestedTools: plan.suggestedTools,
      leaderName: settings.leaderName,
      hasFeishuConfig: Boolean(settings.feishuAppId && settings.feishuAppSecret),
      hasHomeAddress: Boolean(settings.homeAddress),
      hasTencentMapKey: Boolean(settings.tencentMapKey),
    })
    const results: ToolExecutionResult[] = []
    const requestedTools = parsed.data.tools?.length ? new Set(parsed.data.tools) : null
    const shouldRun = (tool: ToolExecutionResult['tool']) =>
      !requestedTools || requestedTools.has(tool)
    const shouldRunRouteSearch =
      shouldRun('search_nearby_clinic') || shouldRun('route_to_clinic')

    if (shouldRun('create_todo_list') && (plan.suggestedTools.includes('create_todo_list') || plan.todos.length > 0)) {
      results.push(
        await safeExecuteTool('create_todo_list', {
          todos: plan.todos.length ? plan.todos : ['先休息观察身体状态'],
          intent: {
            intent: plan.intent,
            severity: plan.severity,
            summary: plan.summary,
            todos: plan.todos,
          },
        }),
      )
    }

    if (shouldRun('send_feishu_message') && plan.suggestedTools.includes('send_feishu_message')) {
      if (!settings.autoMessage) {
        results.push(failedResult('send_feishu_message', '自动发消息权限未开启，请先在设置页打开'))
      } else if (!settings.leaderName.trim()) {
        results.push(failedResult('send_feishu_message', '请先在设置页填写飞书联系人姓名'))
      } else {
        results.push(
          await safeExecuteTool('send_feishu_message', {
            receiver: settings.leaderName,
            feishu_app_id: emptyToUndefined(settings.feishuAppId),
            feishu_app_secret: emptyToUndefined(settings.feishuAppSecret),
            receiver_open_id: emptyToUndefined(settings.leaderOpenId),
            receiver_user_id: emptyToUndefined(settings.leaderUserId),
            receiver_mobile: emptyToUndefined(settings.leaderMobile),
            receiver_email: emptyToUndefined(settings.leaderEmail),
            message_text:
              plan.leaveMessageText ||
              `${settings.leaderName}，我今天身体不太舒服（${plan.summary}），想先请一天病假休息观察。手头紧急事项我会尽量线上同步，谢谢理解。`,
          }),
        )
      }
    }

    if (shouldRunRouteSearch && plan.suggestedTools.includes('search_nearby_clinic')) {
      if (!settings.autoRide) {
        results.push(failedResult('search_nearby_clinic', '自动路线规划权限未开启，请先在设置页打开'))
      } else if (!settings.homeAddress.trim()) {
        results.push(failedResult('search_nearby_clinic', '请先在设置页填写家庭住址'))
      } else {
        results.push(
          await safeExecuteTool('search_nearby_clinic', {
            location: settings.homeAddress,
            severity: plan.severity,
            symptom_summary: plan.summary,
            tencent_key: emptyToUndefined(settings.tencentMapKey),
          }),
        )
      }
    }

    if (
      shouldRun('route_to_clinic') &&
      (plan.suggestedTools.includes('route_to_clinic') || plan.suggestedTools.includes('search_nearby_clinic'))
    ) {
      if (!settings.autoRide) {
        results.push(failedResult('route_to_clinic', '自动路线规划权限未开启，请先在设置页打开'))
      } else {
        const previous = results.find((r) => r.tool === 'search_nearby_clinic')
        const clinics = (previous?.data as
          | { clinics?: Array<{ name: string; address?: string; distanceMeters?: number; location?: { lat: number; lng: number } }> }
          | undefined)?.clinics || []

        if (settings.homeAddress.trim() && clinics.length) {
          results.push(await findFastestRouteToClinic(settings.homeAddress, clinics, emptyToUndefined(settings.tencentMapKey)))
        } else if (plan.suggestedTools.includes('route_to_clinic')) {
          results.push(failedResult('route_to_clinic', '暂时没有可用于路线规划的医院结果'))
        }
      }
    }

    if (shouldRun('notify_emergency_contact') && (plan.suggestedTools.includes('notify_emergency_contact') || plan.intent === 'emergency')) {
      if (!settings.autoMessage) {
        results.push(failedResult('notify_emergency_contact', '自动发消息权限未开启，请先在设置页打开'))
      } else {
        const contactName = settings.emergencyContactFeishuName || settings.emergencyContactName
        if (!contactName.trim()) {
          results.push(failedResult('notify_emergency_contact', '请先在设置页填写紧急联系人姓名'))
        } else {
          results.push(
            await safeExecuteTool('notify_emergency_contact', {
              contact_name: contactName,
              feishu_app_id: emptyToUndefined(settings.feishuAppId),
              feishu_app_secret: emptyToUndefined(settings.feishuAppSecret),
              contact_open_id: emptyToUndefined(settings.emergencyOpenId),
              contact_user_id: emptyToUndefined(settings.emergencyUserId),
              contact_mobile: emptyToUndefined(settings.emergencyPhone),
              contact_email: emptyToUndefined(settings.emergencyEmail),
              message_text: `CareMate 提醒：${settings.userName || '用户'} 现在身体状况不佳（${plan.severity} 风险）。${plan.summary} 建议尽快联系并确认安全，必要时帮忙联系就医。`,
            }),
          )
        }
      }
    }

    if (shouldRun('run_mobile_workflow') && plan.suggestedTools.includes('run_mobile_workflow')) {
      if (!plan.mobileWorkflow) {
        results.push(failedResult('run_mobile_workflow', '缺少手机自动化工作流参数'))
      } else {
        const routeResult = results.find((result) => result.tool === 'route_to_clinic')
        const selectedClinic = (routeResult?.data as { selectedClinic?: { name?: string; address?: string } } | undefined)
          ?.selectedClinic
        results.push(
          await safeExecuteTool('run_mobile_workflow', {
            workflow: {
              ...plan.mobileWorkflow,
              from_address: plan.mobileWorkflow.from_address || settings.homeAddress || undefined,
              destination:
                plan.mobileWorkflow.intent === 'book_ride'
                  ? selectedClinic?.address || selectedClinic?.name || plan.mobileWorkflow.destination
                  : plan.mobileWorkflow.destination,
            },
          }),
        )
      }
    }

    res.json({ success: true, results })
  } catch (error) {
    next(error)
  }
})
async function findFastestRouteToClinic(
  homeAddress: string,
  clinics: Array<{ name: string; address?: string; distanceMeters?: number; location?: { lat: number; lng: number } }>,
  tencentKey?: string,
): Promise<ToolExecutionResult> {
  const attempts = await Promise.all(
    clinics.slice(0, 3).map(async (clinic) => {
      const destination = clinic.location
        ? `${clinic.location.lat},${clinic.location.lng}`
        : clinic.address || clinic.name
      const result = await safeExecuteTool('route_to_clinic', {
        from: homeAddress,
        to: destination,
        mode: 'driving',
        tencent_key: tencentKey,
      })
      return { clinic, result }
    }),
  )

  const successful = attempts
    .filter((attempt) => attempt.result.success)
    .sort((a, b) => {
      const aDuration = ((a.result.data as { durationSeconds?: number } | undefined)?.durationSeconds) ?? Number.MAX_SAFE_INTEGER
      const bDuration = ((b.result.data as { durationSeconds?: number } | undefined)?.durationSeconds) ?? Number.MAX_SAFE_INTEGER
      return aDuration - bDuration
    })

  const best = successful[0]
  if (!best) {
    return attempts[0]?.result || failedResult('route_to_clinic', '暂时没有找到可用路线')
  }

  const routeData = best.result.data as { description?: string; durationSeconds?: number; distanceMeters?: number } | undefined
  return {
    ...best.result,
    message: `最快路线：${best.clinic.name}，${routeData?.description || best.result.message}`,
    data: {
      ...(typeof best.result.data === 'object' && best.result.data ? best.result.data : {}),
      selectedClinic: best.clinic,
      alternatives: successful.map((attempt) => ({
        clinic: attempt.clinic,
        route: attempt.result.data,
      })),
    },
  }
}
async function safeExecuteTool(name: string, args: unknown): Promise<ToolExecutionResult> {
  try {
    return await executeTool(name, args)
  } catch (error) {
    return failedResult(name, error instanceof Error ? error.message : '子任务执行失败')
  }
}

function failedResult(name: string, message: string): ToolExecutionResult {
  return {
    id: `failed-${name}-${Date.now()}`,
    tool: name as ToolExecutionResult['tool'],
    success: false,
    message,
  }
}
