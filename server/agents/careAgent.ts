import OpenAI from 'openai'
import { env } from '../config/env.js'
import { createLocalHealthPlan, healthPlanSchema, type HealthPlan } from '../tools/healthPlan.js'
import { AppError } from '../lib/httpError.js'
import { MAIN_AGENT_PROMPT } from './prompts.js'

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
  timeout: 130_000,
})

export type UserSettingsContext = {
  userName?: string
  leaderName?: string
  leaderOpenId?: string
  homeAddress?: string
  emergencyContactName?: string
  emergencyContactFeishuName?: string
  emergencyContactOpenId?: string
  emergencyPhone?: string
  allergies?: string
  medicalNotes?: string
  tencentMapKey?: string
  autoExecute?: boolean
}

export type ChatTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export type AgentChatResult =
  | { kind: 'message'; text: string }
  | { kind: 'plan'; plan: HealthPlan; assistantMessage: string }

const PROPOSE_PLAN_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_plan',
    description:
      'LLM task router：每次用户描述健康、请假、就医、路线、通知等需求时都必须调用。输出严重程度、待办事项和需要确认后执行的工作流工具。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [
        'intent',
        'severity',
        'summary',
        'todos',
        'recommendedActions',
        'requiresConfirmation',
        'suggestedTools',
        'assistantMessage',
        'leaveMessageText',
      ],
      properties: {
        intent: {
          type: 'string',
          enum: ['health_check', 'leave_request', 'emergency', 'daily_help'],
        },
        severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        summary: { type: 'string', description: '一句话总结用户当前身体状况。' },
        todos: {
          type: 'array',
          items: { type: 'string' },
          description: '具体可执行的照护行动列表。',
        },
        recommendedActions: {
          type: 'array',
          items: { type: 'string' },
          description: '给用户的非工具性建议（休息、饮食、何时就医等）。',
        },
        requiresConfirmation: {
          type: 'boolean',
          description: '是否需要用户口头确认后才执行。涉及发飞书/通知家人/外部任务必须为 true。',
        },
        suggestedTools: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'create_todo_list',
              'send_feishu_message',
              'notify_emergency_contact',
              'search_nearby_clinic',
              'route_to_clinic',
            ],
          },
          description: '需要触发的工具列表。无外部任务时只填 create_todo_list。',
        },
        assistantMessage: {
          type: 'string',
          description:
            '给用户的自然语言回复，温和可靠，不要像医生报告。说明你判断到的情况和准备执行的事项，请用户确认。',
        },
        leaveMessageText: {
          type: ['string', 'null'],
          description: '如包含 send_feishu_message，生成自然的中文请假文案；否则填 null。',
        },
      },
    },
  },
}

function settingsBlock(settings: UserSettingsContext): string {
  const lines = [
    `用户姓名：${settings.userName || '未填写'}`,
    `家庭地址：${settings.homeAddress || '未填写'}`,
    `领导姓名：${settings.leaderName || '未填写'}`,
    `紧急联系人姓名：${settings.emergencyContactFeishuName || settings.emergencyContactName || '未填写'}`,
    `过敏史：${settings.allergies || '无'}`,
    `既往史：${settings.medicalNotes || '无'}`,
  ]
  return lines.join('\n')
}

export async function runAgentTurn(input: {
  messages: ChatTurn[]
  settings: UserSettingsContext
}): Promise<AgentChatResult> {
  const systemPrompt = `${MAIN_AGENT_PROMPT}\n\n用户档案：\n${settingsBlock(input.settings)}`

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...input.messages.map((turn) =>
      turn.role === 'user'
        ? { role: 'user' as const, content: turn.content }
        : { role: 'assistant' as const, content: turn.content },
    ),
  ]

  try {
    const response = await createChatCompletionWithFallback(messages)
    const choice = response.choices[0]
    const toolCall = choice?.message?.tool_calls?.find(
      (call) => call.type === 'function' && call.function.name === 'propose_plan',
    )

    if (toolCall && toolCall.type === 'function') {
      const parsedArgs = JSON.parse(toolCall.function.arguments || '{}')
      const plan = routePlanWithContext(healthPlanSchema.parse(parsedArgs), messages, input.settings)
      return {
        kind: 'plan',
        plan,
        assistantMessage: plan.assistantMessage,
      }
    }

    const text = choice?.message?.content?.trim() || '我在听，可以再多说一点感受吗？'
    return { kind: 'message', text }
  } catch (error) {
    console.error('CareMate main agent failed', normalizeOpenAIError(error))
    if (!env.AGENT_LOCAL_FALLBACK) {
      throw new AppError(
        503,
        'MAIN_MODEL_UNAVAILABLE',
        '主模型暂时不可用。请检查 OPENAI_API_KEY、OPENAI_MODEL、OPENAI_BASE_URL 或网络代理配置。',
      )
    }

    const lastUserText =
      [...input.messages].reverse().find((turn) => turn.role === 'user')?.content || ''
    const fallback = createLocalHealthPlan(lastUserText)
    return {
      kind: 'plan',
      plan: {
        ...fallback,
        assistantMessage: `${fallback.assistantMessage}\n\n（主模型暂时连不上，已启用本地安全规则兜底。）`,
      },
      assistantMessage: fallback.assistantMessage,
    }
  }
}

function routePlanWithContext(
  rawPlan: HealthPlan,
  messages: Array<{ role: string; content: string }>,
  settings: UserSettingsContext,
): HealthPlan {
  const recentUserText = messages
    .filter((turn) => turn.role === 'user')
    .slice(-4)
    .map((turn) => turn.content)
    .join('\n')
  const text = [recentUserText, rawPlan.summary, rawPlan.assistantMessage, rawPlan.leaveMessageText || ''].join('\n').toLowerCase()
  const tools = new Set<HealthPlan['suggestedTools'][number]>(rawPlan.suggestedTools)
  tools.add('create_todo_list')

  const hasWorkNeed = /请假|上班|公司|领导|主管|老板|工作|飞书|去不了|不能去|没法去|发消息|通知/.test(text)
  const wantsClinic = /医院|急诊|就医|看病|附近|社康|诊所|路线|导航|打车|怎么去/.test(text)
  const wantsRoute = /路线|导航|怎么去|去医院|去急诊|打车|出发/.test(text)
  const emergency = /胸痛|胸闷|呼吸困难|喘不上|意识模糊|晕倒|昏迷|抽搐|120|急救|严重脱水|说话不清|肢体无力/.test(text)
  const highFever = /39|40|四十|高烧|高热/.test(text)
  const mediumSignal = /38\.5|38度5|发烧|发热|头晕|呕吐|腹泻|拉肚子|剧烈|疼得厉害|乏力|站不稳/.test(text)

  let intent = rawPlan.intent
  let severity = rawPlan.severity

  if (hasWorkNeed) {
    intent = 'leave_request'
    tools.add('send_feishu_message')
  }

  if (emergency || highFever) {
    intent = 'emergency'
    severity = 'high'
    tools.add('notify_emergency_contact')
    tools.add('search_nearby_clinic')
    tools.add('route_to_clinic')
  } else if (wantsClinic || rawPlan.severity === 'medium' || rawPlan.severity === 'high' || mediumSignal) {
    severity = rawPlan.severity === 'high' ? 'high' : 'medium'
    tools.add('search_nearby_clinic')
    tools.add('route_to_clinic')
  }

  if (wantsRoute) {
    tools.add('search_nearby_clinic')
    tools.add('route_to_clinic')
  }

  const suggestedTools = orderTools([...tools])
  const requiresConfirmation = suggestedTools.some((tool) => tool !== 'create_todo_list')
  const todos = normalizeTodos(rawPlan.todos, {
    hasWorkNeed,
    wantsClinic: wantsClinic || severity !== 'low',
    wantsRoute,
    emergency: severity === 'high',
  })
  const leaveMessageText = suggestedTools.includes('send_feishu_message')
    ? rawPlan.leaveMessageText || buildLeaveMessage(recentUserText, settings, severity)
    : null

  return healthPlanSchema.parse({
    ...rawPlan,
    intent,
    severity,
    todos,
    suggestedTools,
    requiresConfirmation,
    leaveMessageText,
    assistantMessage: buildAssistantMessage({
      plan: rawPlan,
      severity,
      todos,
      suggestedTools,
      requiresConfirmation,
      settings,
    }),
  })
}

function orderTools(tools: HealthPlan['suggestedTools']): HealthPlan['suggestedTools'] {
  const order: HealthPlan['suggestedTools'] = [
    'create_todo_list',
    'send_feishu_message',
    'search_nearby_clinic',
    'route_to_clinic',
    'notify_emergency_contact',
  ]
  return order.filter((tool) => tools.includes(tool))
}

function normalizeTodos(
  todos: string[],
  flags: { hasWorkNeed: boolean; wantsClinic: boolean; wantsRoute: boolean; emergency: boolean },
) {
  const next = new Set(todos.filter((todo) => todo.trim()))
  next.add('先坐下或躺下休息，避免独自外出')
  next.add('补充温水，记录体温和症状变化')
  if (flags.hasWorkNeed) next.add('向领导同步身体情况并请假')
  if (flags.wantsClinic) next.add('查看家附近可去的医院或社康')
  if (flags.wantsRoute) next.add('规划从家庭住址出发的就医路线')
  if (flags.emergency) next.add('如胸痛、呼吸困难或意识不清，立即拨打 120')
  return [...next].slice(0, 6)
}

function buildLeaveMessage(text: string, settings: UserSettingsContext, severity: HealthPlan['severity']) {
  const name = settings.userName ? `我是 ${settings.userName}，` : ''
  const urgency = severity === 'high' ? '需要尽快处理和就医' : '需要先休息观察'
  return `${name}今天身体不太舒服（${text.slice(0, 80) || '身体不适'}），${urgency}，想先请一天病假。手头紧急事项我会尽量线上同步，谢谢理解。`
}

function buildAssistantMessage(input: {
  plan: HealthPlan
  severity: HealthPlan['severity']
  todos: string[]
  suggestedTools: HealthPlan['suggestedTools']
  requiresConfirmation: boolean
  settings: UserSettingsContext
}) {
  const risk = input.severity === 'high' ? '偏高' : input.severity === 'medium' ? '中等' : '较低'
  const taskLabels = input.suggestedTools
    .filter((tool) => tool !== 'create_todo_list')
    .map((tool) => {
      if (tool === 'send_feishu_message') return `给 ${input.settings.leaderName || '设置里的飞书联系人'} 发请假消息`
      if (tool === 'search_nearby_clinic') return '搜索家附近医院'
      if (tool === 'route_to_clinic') return '规划就医路线'
      if (tool === 'notify_emergency_contact') return `通知 ${input.settings.emergencyContactName || '紧急联系人'}`
      return tool
    })
  const taskText = taskLabels.length ? `我会生成这些任务卡片：${taskLabels.join('、')}。` : '我先把照护待办整理出来。'
  const confirm = input.requiresConfirmation ? '你确认后我再执行，避免误发消息或误调用外部服务。' : '这些待办我会先记录下来。'
  return `我先快速判断：当前风险${risk}。${input.plan.summary}\n\n建议先做：${input.todos.slice(0, 3).join('、')}。${taskText}${confirm}`
}
function candidateModels() {
  return Array.from(
    new Set(
      [
        env.OPENAI_MODEL,
        ...env.OPENAI_FALLBACK_MODELS.split(',').map((model) => model.trim()).filter(Boolean),
      ].filter(Boolean),
    ),
  )
}

async function createChatCompletion(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000)
  try {
    return await openai.chat.completions.create(
      {
        model,
        messages,
        tools: [PROPOSE_PLAN_TOOL],
        tool_choice: { type: 'function', function: { name: 'propose_plan' } },
      },
      { signal: controller.signal },
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

async function createChatCompletionWithFallback(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
) {
  let lastError: unknown
  for (const model of candidateModels()) {
    try {
      return await createChatCompletion(model, messages)
    } catch (error) {
      lastError = error
      console.error('CareMate model attempt failed', normalizeOpenAIError(error, model))
      if (!shouldTryNextModel(error)) break
    }
  }
  throw lastError
}

function shouldTryNextModel(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const details = error as { status?: number; code?: string; name?: string; message?: string }
  return (
    details.status === 400 ||
    details.status === 404 ||
    details.status === 408 ||
    details.status === 429 ||
    (typeof details.status === 'number' && details.status >= 500) ||
    details.code === 'model_not_found' ||
    details.name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(details.message || '')
  )
}

function normalizeOpenAIError(error: unknown, model?: string) {
  if (!error || typeof error !== 'object') return { model, message: String(error) }
  const details = error as { name?: string; status?: number; code?: string; type?: string; message?: string }
  return {
    model,
    name: details.name,
    status: details.status,
    code: details.code,
    type: details.type,
    message: details.message,
  }
}
export async function checkModelConnection() {
  try {
    const response = await createChatCompletionWithFallback([
      { role: 'system', content: '你是健康检查接口。' },
      { role: 'user', content: '回复 ok' },
    ])
    return {
      model: response.model,
      ok: Boolean(response.choices[0]?.message),
    }
  } catch (error) {
    console.error('CareMate model status failed', normalizeOpenAIError(error))
    throw new AppError(
      503,
      'MAIN_MODEL_UNAVAILABLE',
      '主模型暂时不可用。请检查 OPENAI_API_KEY、OPENAI_MODEL、OPENAI_BASE_URL 或网络代理配置。',
    )
  }
}
