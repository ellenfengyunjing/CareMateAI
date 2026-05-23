import { z } from 'zod'

export const intentSchema = z.object({
  intent: z.enum(['health_check', 'leave_request', 'emergency', 'daily_help']),
  severity: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  todos: z.array(z.string()),
})

export type AgentIntent = z.infer<typeof intentSchema>

export const sendFeishuMessageSchema = z.object({
  receiver: z.string().min(1),
  message_text: z.string().min(1),
  receiver_open_id: z.string().optional(),
})

export const sendSmsEmergencySchema = z.object({
  phone_number: z.string().min(4),
  message: z.string().min(1),
})

export const createTodoListSchema = z.object({
  todos: z.array(z.string().min(1)).min(1),
  intent: intentSchema.optional(),
})

export const searchNearbyClinicSchema = z.object({
  location: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  symptom_summary: z.string().min(1),
})

export type ToolName =
  | 'send_feishu_message'
  | 'send_sms_emergency'
  | 'create_todo_list'
  | 'search_nearby_clinic'

export const realtimeTools = [
  {
    type: 'function',
    name: 'send_feishu_message',
    description: '发送飞书请假或通知消息。必须在需要请假、通知领导、同步工作情况时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        receiver: {
          type: 'string',
          description: '接收人姓名，例如 Ellen Feng 或 王总。',
        },
        message_text: {
          type: 'string',
          description: '自然、礼貌、符合中国职场语境的请假或通知消息。',
        },
      },
      required: ['receiver', 'message_text'],
    },
  },
  {
    type: 'function',
    name: 'send_sms_emergency',
    description: '发送短信通知紧急联系人。只有高风险或用户明确要求通知家人时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        phone_number: {
          type: 'string',
          description: '紧急联系人手机号。',
        },
        message: {
          type: 'string',
          description: '包含用户症状、当前位置或下一步安排的紧急通知内容。',
        },
      },
      required: ['phone_number', 'message'],
    },
  },
  {
    type: 'function',
    name: 'create_todo_list',
    description: '创建病中照护待办事项，并输出 intent/severity/summary/todos 结构化结果。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        todos: {
          type: 'array',
          items: { type: 'string' },
          description: '需要执行或提醒用户完成的行动列表。',
        },
        intent: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: {
              type: 'string',
              enum: ['health_check', 'leave_request', 'emergency', 'daily_help'],
            },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
            },
            summary: { type: 'string' },
            todos: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['intent', 'severity', 'summary', 'todos'],
        },
      },
      required: ['todos', 'intent'],
    },
  },
  {
    type: 'function',
    name: 'search_nearby_clinic',
    description: '搜索附近社康、医院和路线。用户病情中高风险或确认就医时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        location: {
          type: 'string',
          description: '用户当前位置或家庭地址。',
        },
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
        },
        symptom_summary: {
          type: 'string',
          description: '用户症状摘要。',
        },
      },
      required: ['location', 'severity', 'symptom_summary'],
    },
  },
] as const
