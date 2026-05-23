import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { env } from '../config/env.js'
import { sendMessageToUser } from '../feishu/client.js'
import { getRoute, searchNearbyClinics } from './tencentMap.js'
import {
  createTodoListSchema,
  notifyEmergencyContactSchema,
  routeToClinicSchema,
  searchNearbyClinicSchema,
  sendFeishuMessageSchema,
  type ToolName,
} from './schemas.js'

export type ToolExecutionResult = {
  id: string
  tool: ToolName
  success: boolean
  message: string
  data?: unknown
}

async function deliverFeishuMessage(input: {
  receiverName: string
  text: string
  appId?: string
  appSecret?: string
  openId?: string
  userId?: string
  mobile?: string
  email?: string
}) {
  if (env.FEISHU_MOCK) {
    return {
      provider: 'mock' as const,
      receiver: input.receiverName,
      openId: input.openId || 'ou_mock',
      messageId: `mock_${randomUUID()}`,
      messageText: input.text,
    }
  }
  const appConfig = {
    appId: input.appId,
    appSecret: input.appSecret,
  }
  const sent = await sendMessageToUser(
    {
      name: input.receiverName,
      openId: input.openId,
      userId: input.userId,
      mobile: input.mobile,
      email: input.email,
    },
    input.text,
    appConfig,
  )
  const user = sent.user
  return {
    provider: 'feishu' as const,
    receiver: user.name,
    openId: user.openId,
    messageId: sent.messageId,
    createTime: sent.createTime,
    messageText: input.text,
  }
}

export async function executeTool(name: string, rawArguments: unknown): Promise<ToolExecutionResult> {
  const id = randomUUID()

  if (name === 'create_todo_list') {
    const args = createTodoListSchema.parse(rawArguments)
    return {
      id,
      tool: name,
      success: true,
      message: '已创建照护待办事项',
      data: {
        todos: args.todos,
        intent: args.intent,
      },
    }
  }

  if (name === 'send_feishu_message') {
    const args = sendFeishuMessageSchema.parse(rawArguments)
    const data = await deliverFeishuMessage({
      receiverName: args.receiver,
      text: args.message_text,
      appId: args.feishu_app_id,
      appSecret: args.feishu_app_secret,
      openId: args.receiver_open_id,
      userId: args.receiver_user_id,
      mobile: args.receiver_mobile,
      email: args.receiver_email,
    })
    return {
      id,
      tool: name,
      success: true,
      message: data.provider === 'mock' ? `飞书 mock 已发送给 ${data.receiver}` : `飞书消息已发送给 ${data.receiver}`,
      data,
    }
  }

  if (name === 'notify_emergency_contact') {
    const args = notifyEmergencyContactSchema.parse(rawArguments)
    const data = await deliverFeishuMessage({
      receiverName: args.contact_name,
      text: args.message_text,
      appId: args.feishu_app_id,
      appSecret: args.feishu_app_secret,
      openId: args.contact_open_id,
      userId: args.contact_user_id,
      mobile: args.contact_mobile,
      email: args.contact_email,
    })
    return {
      id,
      tool: name,
      success: true,
      message:
        data.provider === 'mock'
          ? `已通过飞书 mock 通知紧急联系人 ${data.receiver}`
          : `已通过飞书通知紧急联系人 ${data.receiver}`,
      data,
    }
  }

  if (name === 'search_nearby_clinic') {
    const args = searchNearbyClinicSchema.parse(rawArguments)
    const clinics = await searchNearbyClinics({
      location: args.location,
      severity: args.severity,
      keyOverride: args.tencent_key,
    })
    return {
      id,
      tool: name,
      success: true,
      message: clinics.length ? `找到 ${clinics.length} 家附近医疗点` : '附近暂未搜到合适医疗点',
      data: {
        provider: 'tencent-map',
        location: args.location,
        severity: args.severity,
        symptomSummary: args.symptom_summary,
        clinics,
      },
    }
  }

  if (name === 'route_to_clinic') {
    const args = routeToClinicSchema.parse(rawArguments)
    const route = await getRoute({
      from: args.from,
      to: args.to,
      mode: args.mode,
      keyOverride: args.tencent_key,
    })
    return {
      id,
      tool: name,
      success: true,
      message: route.description,
      data: {
        provider: 'tencent-map',
        from: args.from,
        to: args.to,
        ...route,
      },
    }
  }

  throw new Error(`Unknown tool: ${name}`)
}

export function parseToolArguments(args: string | undefined) {
  if (!args) return {}
  try {
    return JSON.parse(args)
  } catch {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['arguments'],
        message: 'Tool arguments must be valid JSON',
        input: args,
      },
    ])
  }
}
