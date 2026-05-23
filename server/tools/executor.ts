import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { env } from '../config/env.js'
import { searchUserByName, sendMessage } from '../feishu/client.js'
import {
  createTodoListSchema,
  searchNearbyClinicSchema,
  sendFeishuMessageSchema,
  sendSmsEmergencySchema,
  type ToolName,
} from './schemas.js'

export type ToolExecutionResult = {
  id: string
  tool: ToolName
  success: boolean
  message: string
  data?: unknown
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

  if (name === 'send_sms_emergency') {
    const args = sendSmsEmergencySchema.parse(rawArguments)
    if (env.SMS_MOCK) {
      return {
        id,
        tool: name,
        success: true,
        message: `短信 mock 已发送给 ${maskPhone(args.phone_number)}`,
        data: {
          provider: 'mock',
          phoneNumber: maskPhone(args.phone_number),
          message: args.message,
        },
      }
    }

    return {
      id,
      tool: name,
      success: false,
      message: '真实短信供应商尚未配置，已阻止发送',
    }
  }

  if (name === 'search_nearby_clinic') {
    const args = searchNearbyClinicSchema.parse(rawArguments)
    return {
      id,
      tool: name,
      success: true,
      message: '已找到附近社康和推荐路线',
      data: {
        provider: 'amap-mock',
        location: args.location,
        severity: args.severity,
        options: [
          {
            name: '南山社区健康服务中心',
            distance: '1.2km',
            route: '步行 14 分钟 / 打车 6 分钟',
            available: '今天 16:30 可预约全科',
          },
          {
            name: '深圳大学总医院',
            distance: '4.8km',
            route: '打车 18 分钟',
            available: '急诊 24 小时',
          },
        ],
      },
    }
  }

  if (name === 'send_feishu_message') {
    const args = sendFeishuMessageSchema.parse(rawArguments)
    if (env.FEISHU_MOCK) {
      return {
        id,
        tool: name,
        success: true,
        message: `飞书 mock 已发送给 ${args.receiver}`,
        data: {
          provider: 'mock',
          receiver: args.receiver,
          messageText: args.message_text,
        },
      }
    }

    const user = args.receiver_open_id
      ? { name: args.receiver, openId: args.receiver_open_id }
      : await searchUserByName(args.receiver)
    const sent = await sendMessage(user.openId, args.message_text)
    return {
      id,
      tool: name,
      success: true,
      message: `飞书消息已发送给 ${user.name}`,
      data: {
        provider: 'feishu',
        receiver: user.name,
        openId: user.openId,
        messageId: sent.messageId,
        createTime: sent.createTime,
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

function maskPhone(phone: string) {
  if (phone.length < 7) return phone
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}
