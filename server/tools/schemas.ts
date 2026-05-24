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
  feishu_app_id: z.string().optional(),
  feishu_app_secret: z.string().optional(),
  receiver_open_id: z.string().optional(),
  receiver_user_id: z.string().optional(),
  receiver_mobile: z.string().optional(),
  receiver_email: z.string().optional(),
})

export const notifyEmergencyContactSchema = z.object({
  contact_name: z.string().min(1),
  message_text: z.string().min(1),
  feishu_app_id: z.string().optional(),
  feishu_app_secret: z.string().optional(),
  contact_open_id: z.string().optional(),
  contact_user_id: z.string().optional(),
  contact_mobile: z.string().optional(),
  contact_email: z.string().optional(),
})

export const createTodoListSchema = z.object({
  todos: z.array(z.string().min(1)).min(1),
  intent: intentSchema.optional(),
})

export const searchNearbyClinicSchema = z.object({
  location: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  symptom_summary: z.string().min(1),
  tencent_key: z.string().optional(),
})

export const routeToClinicSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  mode: z.enum(['walking', 'driving']).default('driving'),
  tencent_key: z.string().optional(),
})

export const mobileWorkflowSchema = z.object({
  intent: z.enum(['buy_medicine', 'book_ride', 'call_phone', 'open_app_task']),
  target_app: z.enum(['meituan', 'didi', 'phone', 'amap', 'other']),
  goal: z.string().min(1),
  medicine_name: z.string().optional(),
  destination: z.string().optional(),
  from_address: z.string().optional(),
  phone_number: z.string().optional(),
  handoff_required_at: z.enum(['payment', 'place_order', 'call_confirm', 'ride_confirm', 'manual_review']).default('manual_review'),
})

export const runMobileWorkflowSchema = z.object({
  workflow: mobileWorkflowSchema,
  dry_run: z.boolean().optional(),
})

export type ToolName =
  | 'send_feishu_message'
  | 'notify_emergency_contact'
  | 'create_todo_list'
  | 'search_nearby_clinic'
  | 'route_to_clinic'
  | 'run_mobile_workflow'

export const realtimeTools = [
  {
    type: 'function',
    name: 'send_feishu_message',
    description: '发送飞书请假或工作通知消息给领导。仅在用户确认请假或同步工作情况时调用。',
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
    name: 'notify_emergency_contact',
    description: '通过飞书通知用户的紧急联系人（家人/朋友）。仅在高风险或用户明确要求通知家人时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        contact_name: {
          type: 'string',
          description: '紧急联系人飞书姓名，例如 妈妈 或 张伟。',
        },
        message_text: {
          type: 'string',
          description: '包含用户当前症状、地点和下一步安排的关切性通知。',
        },
      },
      required: ['contact_name', 'message_text'],
    },
  },
  {
    type: 'function',
    name: 'create_todo_list',
    description: '记录病中照护待办事项，并输出 intent/severity/summary/todos 结构化结果。',
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
    description: '搜索用户附近的社康/医院。需要医疗就诊时调用。',
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
          description: '用户症状摘要，用于选择社康还是急诊。',
        },
      },
      required: ['location', 'severity', 'symptom_summary'],
    },
  },
  {
    type: 'function',
    name: 'route_to_clinic',
    description: '查询从用户位置到指定医院的步行或驾车路线。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: '起点地址或经纬度。' },
        to: { type: 'string', description: '终点医院/社康名称或经纬度。' },
        mode: { type: 'string', enum: ['walking', 'driving'] },
      },
      required: ['from', 'to'],
    },
  },
] as const
