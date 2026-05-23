import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { env } from '../config/env.js'
import { createLocalHealthPlan, healthPlanSchema, type HealthPlan } from '../tools/healthPlan.js'

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 45_000,
})

export type UserSettingsContext = {
  userName?: string
  leaderName?: string
  homeAddress?: string
  emergencyContactName?: string
  emergencyPhone?: string
}

const MAIN_AGENT_PROMPT = `
你是 CareMate 安安的主 Agent，一个面向独居用户的病中代理人。

你的任务：
1. 根据用户描述快速追问或初筛病情严重程度。
2. 输出结构化 intent / severity / summary / todos。
3. 给出解决方法和行动建议。
4. 如果需要现实世界任务，必须建议工具调用，并等待用户确认后执行。

intent 只能是：
- health_check：主要是身体状况判断。
- leave_request：涉及上班、公司、请假、领导、今天去不了公司。
- emergency：胸痛、呼吸困难、意识模糊、晕厥、高烧严重、需要通知家人。
- daily_help：买药、外卖、提醒休息、生活协助。

severity 只能是：
- low：轻微不适，可观察。
- medium：影响工作/生活，需要休息、买药、请假或就医观察。
- high：有明显风险，应尽快就医或通知他人。

工具建议：
- create_todo_list：只要有明确行动建议就加入。
- send_feishu_message：需要给领导请假或工作通知时加入。
- search_nearby_clinic：高烧、头晕明显、行动困难、需要就医路线时加入。
- send_sms_emergency：高风险或用户要求通知紧急联系人时加入。

输出要求：
- assistantMessage 要像一个温和可靠的人，不要像医生报告。
- leaveMessageText 如果需要请假，生成自然、礼貌、符合中国职场语境的请假文案；否则为 null。
- 如果需要执行飞书、地图、短信等现实任务，requiresConfirmation 必须为 true。
- 不要声称已经发送或已经执行，除非工具执行结果返回成功。
`.trim()

export async function createAgentPlan(input: {
  text: string
  settings: UserSettingsContext
}): Promise<HealthPlan> {
  try {
    const response = await openai.responses.parse({
      model: env.OPENAI_MODEL,
      instructions: MAIN_AGENT_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            `用户说：${input.text}`,
            `用户设置：${JSON.stringify(input.settings)}`,
            '请输出结构化计划。',
          ].join('\n'),
        },
      ],
      text: {
        format: zodTextFormat(healthPlanSchema, 'caremate_health_plan'),
        verbosity: 'low',
      },
    })

    if (!response.output_parsed) {
      throw new Error('Main agent returned empty plan')
    }

    return response.output_parsed
  } catch (error) {
    const fallback = createLocalHealthPlan(input.text)
    return {
      ...fallback,
      assistantMessage: `${fallback.assistantMessage}\n\n我这边刚刚连接主模型有点慢，先用安全规则给你做了初步安排。`,
    }
  }
}
