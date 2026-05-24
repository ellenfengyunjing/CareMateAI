import { z } from 'zod'

export const healthPlanSchema = z.object({
  intent: z.enum(['health_check', 'leave_request', 'emergency', 'daily_help']),
  severity: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  todos: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  requiresConfirmation: z.boolean(),
  suggestedTools: z.array(
    z.enum([
      'create_todo_list',
      'send_feishu_message',
      'notify_emergency_contact',
      'search_nearby_clinic',
      'route_to_clinic',
      'run_mobile_workflow',
    ]),
  ),
  mobileWorkflow: z
    .object({
      intent: z.enum(['buy_medicine', 'book_ride', 'call_phone', 'open_app_task']),
      target_app: z.enum(['meituan', 'didi', 'phone', 'amap', 'other']),
      goal: z.string(),
      medicine_name: z.string().optional(),
      destination: z.string().optional(),
      from_address: z.string().optional(),
      phone_number: z.string().optional(),
      handoff_required_at: z.enum(['payment', 'place_order', 'call_confirm', 'ride_confirm', 'manual_review']).default('manual_review'),
    })
    .nullable()
    .optional(),
  assistantMessage: z.string(),
  leaveMessageText: z.string().nullable(),
})

export type HealthPlan = z.infer<typeof healthPlanSchema>

export function createLocalHealthPlan(text: string): HealthPlan {
  const hasCompany = /公司|上班|请假|领导|主管|去不了|不了公司|不能去|没法去/.test(text)
  const hasEmergency = /胸痛|呼吸困难|喘不上|意识|晕倒|昏迷|急救|120/.test(text)
  const hasHighFever = /39|四十|40|高烧/.test(text)
  const hasDizzy = /头晕|晕|乏力|没力气/.test(text)
  const hasDigestive = /腹泻|拉肚子|呕吐|吐|肚子疼|胃痛/.test(text)
  const hasCold = /感冒|咳嗽|嗓子|流鼻涕|鼻塞/.test(text)

  const intent: HealthPlan['intent'] = hasEmergency
    ? 'emergency'
    : hasCompany
      ? 'leave_request'
      : 'health_check'
  const severity: HealthPlan['severity'] =
    hasEmergency || (hasHighFever && hasDizzy)
      ? 'high'
      : hasHighFever || hasDizzy || hasDigestive
        ? 'medium'
        : 'low'

  const todos = ['先坐下或躺下休息', '少量多次补水', '持续观察体温']
  const suggestedTools: HealthPlan['suggestedTools'] = ['create_todo_list']
  const recommendedActions = ['建议今天减少活动，避免独自外出']

  if (hasCompany) {
    todos.unshift('向领导发送病假说明')
    suggestedTools.push('send_feishu_message')
    recommendedActions.push('我可以帮你给领导发一条自然的飞书请假消息')
  }

  if (hasDigestive) {
    todos.push('避免油腻食物，观察是否有脱水迹象')
    recommendedActions.push('腹泻期间注意补液；如果持续高烧、血便或明显脱水，建议及时就医')
  }

  if (hasCold) {
    todos.push('根据症状准备感冒药或退烧药')
    recommendedActions.push('如果是普通感冒症状，可以考虑线上买药到家并休息观察')
  }

  if (severity === 'high' || hasEmergency) {
    todos.push('搜索附近社康/医院路线')
    suggestedTools.push('search_nearby_clinic')
    suggestedTools.push('notify_emergency_contact')
    recommendedActions.push('建议尽快就近就医；如果出现胸痛、呼吸困难或意识不清，请立即联系急救')
  } else if (severity === 'medium') {
    suggestedTools.push('search_nearby_clinic')
    recommendedActions.push('如果症状没有缓解，可以去附近社康看一下')
  }

  return {
    intent,
    severity,
    summary: hasHighFever
      ? '用户发烧较高并伴随不适，可能影响今天工作和行动。'
      : '用户描述身体不适，需要先休息并观察症状变化。',
    todos,
    recommendedActions,
    requiresConfirmation: suggestedTools.some((tool) => tool !== 'create_todo_list'),
    suggestedTools,
    assistantMessage: `${hasHighFever ? '我判断你现在发烧偏高，需要先休息并减少活动。' : '我先帮你把情况整理一下。'}${hasCompany ? '如果你确认，我可以帮你给领导发飞书请假。' : ''}`,
    leaveMessageText: hasCompany
      ? `我今天身体不太舒服（${text}），状态不太适合到公司，想先请一天病假休息观察一下。手头紧急事项我会尽量线上同步，如果有特别急的事情可以电话联系我。谢谢理解。`
      : null,
  }
}
