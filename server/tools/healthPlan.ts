import { z } from 'zod'

export const healthPlanSchema = z.object({
  intent: z.enum(['health_check', 'leave_request', 'emergency', 'daily_help']),
  severity: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  todos: z.array(z.string()),
  recommendedActions: z.array(z.string()),
  requiresConfirmation: z.boolean(),
  suggestedTools: z.array(z.string()),
})

export type HealthPlan = z.infer<typeof healthPlanSchema>

export function createLocalHealthPlan(text: string): HealthPlan {
  const hasCompany = /公司|上班|请假|领导|主管|去不了|不了公司|不能去|没法去/.test(text)
  const hasEmergency = /胸痛|呼吸困难|喘不上|意识|晕倒|昏迷|急救|120/.test(text)
  const hasHighFever = /39|四十|40|高烧/.test(text)
  const hasDizzy = /头晕|晕|乏力|没力气/.test(text)

  const intent = hasEmergency ? 'emergency' : hasCompany ? 'leave_request' : 'health_check'
  const severity = hasEmergency || (hasHighFever && hasDizzy) ? 'high' : hasHighFever || hasDizzy ? 'medium' : 'low'
  const todos = ['先坐下或躺下休息', '少量多次补水', '持续观察体温']
  const suggestedTools = ['create_todo_list']
  const recommendedActions = ['建议今天减少活动，避免独自外出']

  if (hasCompany) {
    todos.unshift('向领导发送病假说明')
    suggestedTools.push('send_feishu_message')
    recommendedActions.push('我可以帮你给领导发一条自然的飞书请假消息')
  }

  if (severity === 'high') {
    todos.push('搜索附近社康/医院路线')
    suggestedTools.push('search_nearby_clinic')
    recommendedActions.push('建议尽快就近就医；如果出现胸痛、呼吸困难或意识不清，请立即联系急救')
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
  }
}
