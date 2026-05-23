import type { Server } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { env } from '../config/env.js'
import { realtimeAgentInstructions } from '../agents/prompts.js'
import { executeTool, parseToolArguments } from '../tools/executor.js'
import { logEvent } from '../logging/logger.js'

type ClientMessage =
  | {
      type: 'session.start'
      leaderName?: string
      leaderOpenId?: string
      leaderUserId?: string
      leaderMobile?: string
      leaderEmail?: string
      emergencyContactFeishuName?: string
      emergencyPhone?: string
      emergencyOpenId?: string
      emergencyUserId?: string
      emergencyEmail?: string
      feishuAppId?: string
      feishuAppSecret?: string
      debug?: boolean
    }
  | { type: 'audio.append'; audio: string }
  | { type: 'audio.commit' }
  | { type: 'text.send'; text: string }
  | { type: 'response.cancel' }

type ClientContext = {
  leaderName: string
  leaderOpenId?: string
  leaderUserId?: string
  leaderMobile?: string
  leaderEmail?: string
  emergencyContactFeishuName?: string
  emergencyPhone: string
  emergencyOpenId?: string
  emergencyUserId?: string
  emergencyEmail?: string
  feishuAppId?: string
  feishuAppSecret?: string
  debug: boolean
}

export function attachRealtimeServer(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws/realtime' })

  wss.on('connection', (client) => {
    const context: ClientContext = {
      leaderName: 'Ellen Feng',
      emergencyPhone: '13800000000',
      debug: true,
    }
    let openaiSocket: WebSocket | null = null
    const pendingCalls = new Map<string, { name: string; arguments: string }>()

    const sendClient = (payload: unknown) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload))
      }
    }

    const sendOpenAI = (payload: unknown) => {
      if (openaiSocket?.readyState === WebSocket.OPEN) {
        openaiSocket.send(JSON.stringify(payload))
      }
    }

    const connectRealtime = () => {
      openaiSocket = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`,
        {
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        },
      )

      openaiSocket.on('open', () => {
        sendClient({ type: 'status', status: 'connected' })
        sendOpenAI({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: buildInstructions(context),
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'gpt-4o-mini-transcribe',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.55,
              prefix_padding_ms: 300,
              silence_duration_ms: 650,
            },
            tools: [],
            tool_choice: 'none',
          },
        })
      })

      openaiSocket.on('message', async (data) => {
        const event = JSON.parse(data.toString())
        if (context.debug) {
          sendClient({ type: 'debug', direction: 'openai', event: summarizeRealtimeEvent(event) })
        }
        await logEvent('openai.event', summarizeRealtimeEvent(event))

        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          sendClient({ type: 'transcript.user', text: event.transcript })
        }

        if (event.type === 'response.audio.delta') {
          sendClient({ type: 'audio.delta', audio: event.delta })
        }

        if (event.type === 'response.audio_transcript.delta') {
          sendClient({ type: 'transcript.ai.delta', text: event.delta })
        }

        if (event.type === 'response.audio_transcript.done') {
          sendClient({ type: 'transcript.ai.done', text: event.transcript })
        }

        if (event.type === 'response.function_call_arguments.done') {
          pendingCalls.set(event.call_id, {
            name: event.name,
            arguments: event.arguments,
          })
          await executeRealtimeTool(event.call_id, event.name, event.arguments)
        }

        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
          const callId = event.item.call_id
          if (!pendingCalls.has(callId)) {
            pendingCalls.set(callId, {
              name: event.item.name,
              arguments: event.item.arguments,
            })
            await executeRealtimeTool(callId, event.item.name, event.item.arguments)
          }
        }
      })

      openaiSocket.on('close', () => {
        sendClient({ type: 'status', status: 'disconnected' })
      })

      openaiSocket.on('error', (error) => {
        sendClient({ type: 'error', message: `Realtime 连接错误：${error.message}` })
      })
    }

    const executeRealtimeTool = async (callId: string, name: string, rawArguments: string) => {
      try {
        const args = withRealtimeFeishuContext(name, parseToolArguments(rawArguments), context)
        sendClient({ type: 'tool.started', name, arguments: summarizeToolArguments(args) })
        await logEvent('tool.started', { callId, name, args: summarizeToolArguments(args) })

        const result = await executeTool(name, args)
        sendClient({ type: 'tool.succeeded', name, result })
        await logEvent('tool.succeeded', { callId, name, result })

        sendOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result),
          },
        })
        sendOpenAI({ type: 'response.create' })
      } catch (error) {
        const message = error instanceof Error ? error.message : '工具执行失败'
        sendClient({ type: 'tool.failed', name, message })
        await logEvent('tool.failed', { callId, name, message })
        sendOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ success: false, message }),
          },
        })
        sendOpenAI({ type: 'response.create' })
      }
    }

    client.on('message', async (data) => {
      const message = JSON.parse(data.toString()) as ClientMessage
      await logEvent('client.event', { type: message.type })

      if (message.type === 'session.start') {
        context.leaderName = message.leaderName || context.leaderName
        context.leaderOpenId = emptyToUndefined(message.leaderOpenId)
        context.leaderUserId = emptyToUndefined(message.leaderUserId)
        context.leaderMobile = emptyToUndefined(message.leaderMobile)
        context.leaderEmail = emptyToUndefined(message.leaderEmail)
        context.emergencyContactFeishuName = emptyToUndefined(message.emergencyContactFeishuName)
        context.emergencyPhone = message.emergencyPhone || context.emergencyPhone
        context.emergencyOpenId = emptyToUndefined(message.emergencyOpenId)
        context.emergencyUserId = emptyToUndefined(message.emergencyUserId)
        context.emergencyEmail = emptyToUndefined(message.emergencyEmail)
        context.feishuAppId = emptyToUndefined(message.feishuAppId)
        context.feishuAppSecret = emptyToUndefined(message.feishuAppSecret)
        context.debug = message.debug ?? context.debug
        connectRealtime()
        return
      }

      if (!openaiSocket || openaiSocket.readyState !== WebSocket.OPEN) {
        sendClient({ type: 'error', message: 'Realtime 尚未连接，请先开始会话' })
        return
      }

      if (message.type === 'audio.append') {
        sendOpenAI({
          type: 'input_audio_buffer.append',
          audio: message.audio,
        })
      }

      if (message.type === 'audio.commit') {
        sendOpenAI({ type: 'input_audio_buffer.commit' })
      }

      if (message.type === 'text.send') {
        sendOpenAI({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: message.text }],
          },
        })
        sendOpenAI({ type: 'response.create' })
      }

      if (message.type === 'response.cancel') {
        sendOpenAI({ type: 'response.cancel' })
      }
    })

    client.on('close', () => {
      openaiSocket?.close()
    })
  })
}

function buildInstructions(context: ClientContext) {
  return `${realtimeAgentInstructions}

用户配置：
- 默认领导姓名：${context.leaderName}
- 默认紧急联系人姓名：${context.emergencyContactFeishuName || '未填写'}
- 默认紧急联系人电话：${context.emergencyPhone}

当用户说“今天可能去不了公司”“帮我请假”“身体不舒服不能上班”等，请优先向 ${context.leaderName} 发送飞书请假消息。工具执行时会自动使用用户设置中的飞书应用配置和联系人解析信息。

注意：语音通道只负责把用户语音转成文字，不直接执行外部子任务。收到转写文本后，由主界面的 Agent 统一进行多轮判断、生成任务卡片，并等待用户确认后再执行。`
}

function withRealtimeFeishuContext(name: string, args: unknown, context: ClientContext) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args

  if (name === 'send_feishu_message') {
    return {
      ...args,
      receiver: (args as { receiver?: string }).receiver || context.leaderName,
      feishu_app_id: context.feishuAppId,
      feishu_app_secret: context.feishuAppSecret,
      receiver_open_id: context.leaderOpenId,
      receiver_user_id: context.leaderUserId,
      receiver_mobile: context.leaderMobile,
      receiver_email: context.leaderEmail,
    }
  }

  if (name === 'notify_emergency_contact') {
    return {
      ...args,
      contact_name:
        (args as { contact_name?: string }).contact_name || context.emergencyContactFeishuName || '紧急联系人',
      feishu_app_id: context.feishuAppId,
      feishu_app_secret: context.feishuAppSecret,
      contact_open_id: context.emergencyOpenId,
      contact_user_id: context.emergencyUserId,
      contact_mobile: context.emergencyPhone,
      contact_email: context.emergencyEmail,
    }
  }

  return args
}

function summarizeToolArguments(args: unknown) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  const summary = { ...args } as Record<string, unknown>
  if (summary.feishu_app_secret) summary.feishu_app_secret = '<masked>'
  return summary
}

function emptyToUndefined(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function summarizeRealtimeEvent(event: Record<string, unknown>) {
  return {
    type: event.type,
    itemType: (event.item as { type?: string } | undefined)?.type,
    name: event.name || (event.item as { name?: string } | undefined)?.name,
    callId: event.call_id || (event.item as { call_id?: string } | undefined)?.call_id,
    error: event.error,
  }
}

