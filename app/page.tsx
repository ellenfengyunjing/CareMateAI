'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  Edit3,
  Heart,
  HeartPulse,
  House,
  KeyRound,
  Link2,
  MapPinned,
  Mic,
  MicOff,
  Phone,
  PlusCircle,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserPlus,
  UserRound,
} from 'lucide-react'

type Page = 'assistant' | 'settings'
type Role = 'user' | 'ai' | 'system'

type ChatMessage = {
  id: string
  role: Role
  text: string
  plan?: HealthPlan | null
  tools?: ToolCard[]
  awaitingConfirmation?: boolean
}

type ToolName =
  | 'create_todo_list'
  | 'send_feishu_message'
  | 'notify_emergency_contact'
  | 'search_nearby_clinic'
  | 'route_to_clinic'

type HealthPlan = {
  intent: 'health_check' | 'leave_request' | 'emergency' | 'daily_help'
  severity: 'low' | 'medium' | 'high'
  summary: string
  todos: string[]
  recommendedActions: string[]
  requiresConfirmation: boolean
  suggestedTools: ToolName[]
  assistantMessage: string
  leaveMessageText: string | null
}

type ToolResult = {
  tool: ToolName
  success: boolean
  message: string
  data?: unknown
}

type ToolCard = {
  id: string
  name: ToolName
  detail: string
  status: 'ready' | 'running' | 'done' | 'failed'
  tone: 'blue' | 'green' | 'orange' | 'pink' | 'yellow'
}

type UserSettings = {
  userName: string
  leaderName: string
  leaderOpenId: string
  leaderUserId: string
  leaderMobile: string
  leaderEmail: string
  feishuAppId: string
  feishuAppSecret: string
  homeAddress: string
  emergencyContactName: string
  emergencyContactFeishuName: string
  emergencyPhone: string
  emergencyOpenId: string
  emergencyUserId: string
  emergencyEmail: string
  allergies: string
  medicalNotes: string
  tencentMapKey: string
  autoRide: boolean
  autoMessage: boolean
}

const DEFAULT_SETTINGS: UserSettings = {
  userName: '',
  leaderName: '',
  leaderOpenId: '',
  leaderUserId: '',
  leaderMobile: '',
  leaderEmail: '',
  feishuAppId: '',
  feishuAppSecret: '',
  homeAddress: '',
  emergencyContactName: '',
  emergencyContactFeishuName: '',
  emergencyPhone: '',
  emergencyOpenId: '',
  emergencyUserId: '',
  emergencyEmail: '',
  allergies: '',
  medicalNotes: '',
  tencentMapKey: '',
  autoRide: true,
  autoMessage: true,
}

const SETTINGS_KEY = 'caremate-settings'
const CHAT_KEY = 'caremate-chat'

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'ai',
    text: '安安在听。直接告诉我哪里不舒服，我会先了解情况，再把建议和可执行事项告诉你。',
  },
]

export default function Home() {
  const [page, setPage] = useState<Page>('assistant')
  const [recording, setRecording] = useState(false)
  const [inputText, setInputText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [plan, setPlan] = useState<HealthPlan | null>(null)
  const [tools, setTools] = useState<ToolCard[]>([])
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [activePlanMessageId, setActivePlanMessageId] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)

  const wsRef = useRef<WebSocket | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const silentGainRef = useRef<GainNode | null>(null)
  const currentAiMessageIdRef = useRef<string | null>(null)
  const voiceReplyEnabledRef = useRef(false)
  const longListeningRef = useRef(false)
  const wakeArmedRef = useRef(false)
  const voiceHeardSpeechRef = useRef(false)
  const voiceSilenceTimerRef = useRef<number | null>(null)
  const voiceRestartTimerRef = useRef<number | null>(null)
  const hydratedRef = useRef(false)

  useEffect(() => {
    let mounted = true
    const loadSettings = async () => {
      try {
        const savedSettings = window.localStorage.getItem(SETTINGS_KEY)
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings) as Partial<UserSettings>
          if (mounted) setSettings({ ...DEFAULT_SETTINGS, ...parsed })
        }
        const response = await fetch('/api/settings')
        if (response.ok) {
          const data = (await response.json()) as { settings?: Partial<UserSettings> }
          if (data.settings && mounted) setSettings({ ...DEFAULT_SETTINGS, ...data.settings })
        }
        const savedChat = window.localStorage.getItem(CHAT_KEY)
        if (savedChat) {
          const parsed = JSON.parse(savedChat) as {
            messages?: ChatMessage[]
            plan?: HealthPlan | null
            tools?: ToolCard[]
            awaitingConfirmation?: boolean
            activePlanMessageId?: string | null
          }
          if (parsed.messages?.length) {
            const nextMessages = migrateStoredMessages(parsed.messages, parsed.plan, parsed.tools, parsed.awaitingConfirmation)
            const activeMessage =
              nextMessages.find((message) => message.id === parsed.activePlanMessageId && message.plan) ||
              [...nextMessages].reverse().find((message) => message.plan)
            setMessages(nextMessages)
            if (activeMessage?.plan) {
              setPlan(activeMessage.plan)
              setTools(activeMessage.tools || [])
              setAwaitingConfirmation(Boolean(activeMessage.awaitingConfirmation))
              setActivePlanMessageId(activeMessage.id)
            }
          }
        }
      } catch {
        window.localStorage.removeItem(SETTINGS_KEY)
        window.localStorage.removeItem(CHAT_KEY)
      } finally {
        hydratedRef.current = true
      }
    }
    void loadSettings()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!hydratedRef.current) return
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    const timeout = window.setTimeout(() => {
      void fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [settings])

  useEffect(() => {
    if (!hydratedRef.current) return
    window.localStorage.setItem(CHAT_KEY, JSON.stringify({ messages, activePlanMessageId }))
  }, [messages, activePlanMessageId])

  const statusText = useMemo(() => {
    if (recording) return '正在倾听...'
    if (thinking) return '安安在思考...'
    if (awaitingConfirmation) return '等待你确认执行'
    if (tools.some((tool) => tool.status === 'running')) return '正在替你处理'
    return '随时和我说话'
  }, [awaitingConfirmation, recording, thinking, tools])

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const addMessage = (role: Role, text: string) => {
    const id = crypto.randomUUID()
    setMessages((current) => [...current, { id, role, text }])
    return id
  }

  const addPlanMessage = (text: string, nextPlan: HealthPlan) => {
    const id = crypto.randomUUID()
    const nextTools = buildReadyTools(nextPlan)
    setMessages((current) => [
      ...current,
      {
        id,
        role: 'ai',
        text,
        plan: nextPlan,
        tools: nextTools,
        awaitingConfirmation: nextPlan.requiresConfirmation,
      },
    ])
    setPlan(nextPlan)
    setTools(nextTools)
    setAwaitingConfirmation(nextPlan.requiresConfirmation)
    setActivePlanMessageId(id)
    return id
  }

  const updatePlanMessage = (messageId: string | null, updater: (message: ChatMessage) => ChatMessage) => {
    if (!messageId) return
    setMessages((current) => current.map((message) => (message.id === messageId ? updater(message) : message)))
  }

  const appendAiDelta = (text: string) => {
    setMessages((current) => {
      const id = currentAiMessageIdRef.current
      if (id) {
        return current.map((message) =>
          message.id === id ? { ...message, text: `${message.text}${text}` } : message,
        )
      }
      const nextId = crypto.randomUUID()
      currentAiMessageIdRef.current = nextId
      return [...current, { id: nextId, role: 'ai', text }]
    })
  }

  const clearChat = () => {
    setMessages(initialMessages)
    setPlan(null)
    setTools([])
    setAwaitingConfirmation(false)
    setActivePlanMessageId(null)
    currentAiMessageIdRef.current = null
  }

  const speakAssistantText = (text: string) => {
    if (!voiceReplyEnabledRef.current) return
    if (!('speechSynthesis' in window)) return
    const cleaned = text.replace(/https?:\/\/[^\s]+/g, '').trim()
    if (!cleaned) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(cleaned)
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }

  // PLACEHOLDER_HOME_BODY removed
  const connectRealtime = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(`ws://${window.location.hostname}:8787/ws/realtime`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'session.start',
          leaderName: settings.leaderName,
          leaderOpenId: settings.leaderOpenId,
          leaderUserId: settings.leaderUserId,
          leaderMobile: settings.leaderMobile,
          leaderEmail: settings.leaderEmail,
          emergencyContactFeishuName: settings.emergencyContactFeishuName,
          emergencyPhone: settings.emergencyPhone,
          emergencyOpenId: settings.emergencyOpenId,
          emergencyUserId: settings.emergencyUserId,
          emergencyEmail: settings.emergencyEmail,
          feishuAppId: settings.feishuAppId,
          feishuAppSecret: settings.feishuAppSecret,
          debug: false,
        }),
      )
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'transcript.user') {
        voiceReplyEnabledRef.current = true
        void handleUserText(data.text).finally(() => {
          if (longListeningRef.current && !recording) {
            if (voiceRestartTimerRef.current) window.clearTimeout(voiceRestartTimerRef.current)
            voiceRestartTimerRef.current = window.setTimeout(() => {
              if (longListeningRef.current && !recording) void toggleVoice()
            }, 700)
          }
        })
      }
      if (data.type === 'transcript.ai.delta') {
        appendAiDelta(data.text)
      }
      if (data.type === 'transcript.ai.done') {
        currentAiMessageIdRef.current = null
      }
      if (data.type === 'error') {
        addMessage('system', '实时语音暂时连不上，可以直接用下方文字框跟我聊。')
      }
    }
  }

  const toggleVoice = async () => {
    if (recording) {
      longListeningRef.current = false
      stopRecording()
      return
    }

    connectRealtime()
    longListeningRef.current = true

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        addMessage('system', '当前浏览器不支持麦克风采集。请用 Chrome、Edge 或允许麦克风的内置浏览器打开。')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const audioContext = new AudioContext()
      await audioContext.resume()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      const silentGain = audioContext.createGain()
      silentGain.gain.value = 0

      processor.onaudioprocess = (event) => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const input = event.inputBuffer.getChannelData(0)
        const rms = getRms(input)
        if (rms > 0.018) {
          voiceHeardSpeechRef.current = true
          if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current)
          voiceSilenceTimerRef.current = window.setTimeout(() => {
            if (voiceHeardSpeechRef.current) stopRecording({ auto: true })
          }, 1200)
        }

        const pcm16k = resampleFloat32Array(input, audioContext.sampleRate, 16000)
        ws.send(
          JSON.stringify({
            type: 'audio.append',
            audio: floatTo16BitPcmBase64(pcm16k),
          }),
        )
      }

      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(audioContext.destination)
      mediaStreamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      processorRef.current = processor
      silentGainRef.current = silentGain
      voiceHeardSpeechRef.current = false
      setRecording(true)
    } catch (error) {
      const detail = error instanceof Error ? `${error.name || 'Error'}：${error.message}` : '未知错误'
      addMessage('system', `麦克风启动失败：${detail}。请确认浏览器地址栏已允许 localhost 使用麦克风，然后再点一次语音按钮。`)
    }
  }

  const stopRecording = (options: { auto?: boolean; commit?: boolean } = {}) => {
    const shouldCommit = options.commit ?? true
    if (voiceSilenceTimerRef.current) window.clearTimeout(voiceSilenceTimerRef.current)
    voiceSilenceTimerRef.current = null
    if (shouldCommit && voiceHeardSpeechRef.current) wsRef.current?.send(JSON.stringify({ type: 'audio.commit' }))
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    silentGainRef.current?.disconnect()
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    void audioContextRef.current?.close()
    processorRef.current = null
    sourceRef.current = null
    silentGainRef.current = null
    mediaStreamRef.current = null
    audioContextRef.current = null
    voiceHeardSpeechRef.current = false
    setRecording(false)
  }

  const handleUserText = async (text: string) => {
    let normalized = text.trim()
    if (!normalized) return
    setInputText('')

    const pendingMessage =
      messages.find((message) => message.id === activePlanMessageId && message.plan) ||
      [...messages].reverse().find((message) => message.plan && message.awaitingConfirmation)
    const pendingPlan = pendingMessage?.plan || plan
    const pendingAwaiting = Boolean(pendingMessage?.awaitingConfirmation ?? awaitingConfirmation)

    if (pendingPlan && pendingAwaiting && /确认|可以|执行|发送|帮我发|就这样|好的|去吧|是的|继续|好|可以的/.test(normalized)) {
      addMessage('user', normalized)
      await executePlan(pendingPlan, pendingMessage?.id || activePlanMessageId)
      return
    }

    if (voiceReplyEnabledRef.current) {
      const voiceCommand = getVoiceCommand(normalized, wakeArmedRef.current)
      if (!voiceCommand.shouldProcess) {
        addMessage('system', '我听到了。需要我处理时，请先叫“安安”或“安安同学”。')
        return
      }
      if (!voiceCommand.text) {
        wakeArmedRef.current = true
        const reply = '我在，你继续说。'
        addMessage('ai', reply)
        speakAssistantText(reply)
        return
      }
      wakeArmedRef.current = false
      normalized = voiceCommand.text
    }

    if (
      plan &&
      awaitingConfirmation &&
      /确认|可以|执行|发送|帮我发|就这样|好的|去吧/.test(normalized)
    ) {
      addMessage('user', normalized)
      await executePlan(plan)
      return
    }

    const baseMessages = messages
      .filter((m) => (m.role === 'user' || m.role === 'ai') && !m.text.startsWith('我收到了，正在结合你的档案分析'))
      .map((m) => ({
        role: m.role === 'ai' ? ('assistant' as const) : ('user' as const),
        content: m.text,
      }))
    addMessage('user', normalized)
    addMessage('ai', '我收到了，正在结合你的档案分析症状和下一步安排。')
    const chatHistory = [...baseMessages, { role: 'user' as const, content: normalized }]

    setThinking(true)
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory, settings }),
      })
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { message?: string }
        addMessage('system', `安安暂时不在线：${err.message || response.statusText}`)
        return
      }
      const data = (await response.json()) as
        | { kind: 'message'; text: string }
        | { kind: 'plan'; plan: HealthPlan; assistantMessage: string }
      if (data.kind === 'message') {
        const reply = data.text || '我在听，可以再多说一点感受吗？'
        addMessage('ai', reply)
        speakAssistantText(reply)
      } else if (data.kind === 'plan' && data.plan) {
        const nextPlan = data.plan
        const reply = nextPlan.assistantMessage || buildPlanMessage(nextPlan)
        const planMessageId = addPlanMessage(reply, nextPlan)
        speakAssistantText(reply)
        if (!nextPlan.requiresConfirmation) {
          await executePlan(nextPlan, planMessageId)
        }
      }
    } catch (error) {
      addMessage('system', `网络异常：${error instanceof Error ? error.message : '请稍后再试'}`)
    } finally {
      setThinking(false)
    }
  }

  const executePlan = async (targetPlan: HealthPlan, messageId = activePlanMessageId) => {
    setAwaitingConfirmation(false)
    setTools((current) => current.map((tool) => ({ ...tool, status: 'running' })))
    updatePlanMessage(messageId, (message) => ({
      ...message,
      awaitingConfirmation: false,
      tools: (message.tools || []).map((tool) => ({ ...tool, status: 'running' })),
    }))
    addMessage('ai', '好的，我现在开始执行。你先坐下休息，手机这边我来处理。')

    try {
      const response = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: targetPlan, settings }),
      })
      const data = (await response.json()) as {
        success?: boolean
        message?: string
        results?: Array<ToolResult>
      }
      if (!response.ok) {
        addMessage('system', `执行失败：${data.message || response.statusText}`)
        setTools((current) =>
          current.map((tool) => ({ ...tool, status: 'failed', detail: data.message || '执行失败' })),
        )
        return
      }
      const results = data.results || []
      setTools((current) => {
        const used = new Set<string>()
        const hasRouteCard = current.some((tool) => tool.name === 'route_to_clinic')
        const hasRouteResult = results.some((result) => result.tool === 'route_to_clinic')
        const updated = current.map((tool) => {
          const matched = findResultForTool(tool, results, used)
          if (matched) used.add(matched.tool)
          return matched
            ? {
                ...tool,
                status: matched.success ? ('done' as const) : ('failed' as const),
                detail: formatToolResult(matched),
              }
            : tool
        })
        results.forEach((r) => {
          if (r.tool === 'search_nearby_clinic' && (hasRouteCard || hasRouteResult)) return
          if (!current.some((t) => t.name === r.tool)) {
            updated.push({
              id: crypto.randomUUID(),
              name: r.tool,
              detail: formatToolResult(r),
              status: r.success ? 'done' : 'failed',
              tone: toolTone(r.tool),
            })
          }
        })
        return updated
      })
      updatePlanMessage(messageId, (message) => ({
        ...message,
        tools: applyToolResults(message.tools || [], results),
      }))
      const okCount = results.filter((r) => r.success).length
      const summary = buildExecutionSummary(results, okCount)
      addMessage('ai', summary)
      speakAssistantText(summary)
    } catch (error) {
      addMessage('system', `执行异常：${error instanceof Error ? error.message : '请稍后再试'}`)
      setTools((current) => current.map((tool) => ({ ...tool, status: 'failed' })))
    }
  }

  return (
    <main className="mobile-shell">
      {page === 'assistant' ? (
        <AssistantPage
          messages={messages}
          tools={tools}
          plan={plan}
          statusText={statusText}
          recording={recording}
          inputText={inputText}
          awaitingConfirmation={awaitingConfirmation}
          thinking={thinking}
          onInputChange={setInputText}
          onVoice={toggleVoice}
          onSend={() => {
            voiceReplyEnabledRef.current = false
            void handleUserText(inputText)
          }}
          onConfirm={(targetPlan, messageId) => {
            const nextPlan = targetPlan || plan
            if (nextPlan) void executePlan(nextPlan, messageId || activePlanMessageId)
          }}
          onClear={clearChat}
          hasPendingTools={Boolean(plan && tools.some((tool) => tool.status === 'ready'))}
        />
      ) : (
        <SettingsPage settings={settings} onUpdate={updateSetting} />
      )}

      <BottomNav page={page} onChange={setPage} />
    </main>
  )
}

function AssistantPage(props: {
  messages: ChatMessage[]
  tools: ToolCard[]
  plan: HealthPlan | null
  statusText: string
  recording: boolean
  inputText: string
  awaitingConfirmation: boolean
  thinking: boolean
  onInputChange: (text: string) => void
  onVoice: () => void
  onSend: () => void
  onConfirm: (plan?: HealthPlan, messageId?: string) => void
  onClear: () => void
  hasPendingTools: boolean
}) {
  return (
    <>
      <header className="top-bar">
        <div>
          <h1>CareMate 安安</h1>
          <p>你的独居陪护小助手</p>
        </div>
        <div className="top-bar-actions">
          <button className="ghost-btn" onClick={props.onClear} aria-label="清空对话">
            <RotateCcw size={16} />
          </button>
          <div className="mini-avatar">
            <HeartPulse size={20} />
          </div>
        </div>
      </header>

      <section className="orb-section">
        <button
          className={`voice-orb ${props.recording ? 'active' : ''}`}
          onClick={props.onVoice}
          aria-label="语音沟通"
        >
          <span className="orb-aura" />
          <span className="orb-core">{props.recording ? <MicOff size={42} /> : <Mic size={42} />}</span>
        </button>
        <p className="listen-label">{props.statusText}</p>
      </section>

      <section className="conversation">
        {props.messages.map((message) => (
          <div key={message.id}>
            <article className={`bubble-row ${message.role}`}>
              {message.role !== 'user' && (
                <div className="assistant-mark">
                  <Sparkles size={16} />
                </div>
              )}
              <div className="bubble">
                <MessageText text={message.text} />
              </div>
            </article>

            {message.plan && (
              <article className="agent-card">
                <div className="card-heading">
                  <Stethoscope size={18} />
                  <span>Agent 判断</span>
                  <b>{message.plan.severity}</b>
                </div>
                <p>{message.plan.summary}</p>
                <ul>
                  {message.plan.todos.map((todo) => (
                    <li key={todo}>{todo}</li>
                  ))}
                </ul>
              </article>
            )}

            {message.tools && message.tools.length > 0 && (
              <div className="action-stack">
                {message.tools.map((tool) => (
                  <ToolActionCard
                    tool={tool}
                    key={tool.id}
                    onConfirm={() => props.onConfirm(message.plan || undefined, message.id)}
                  />
                ))}
              </div>
            )}

            {(message.awaitingConfirmation || message.tools?.some((tool) => tool.status === 'ready')) && message.plan && (
              <button className="confirm-card" onClick={() => props.onConfirm(message.plan || undefined, message.id)}>
                <ShieldCheck size={18} />
                <span>确认执行这些安排</span>
              </button>
            )}
          </div>
        ))}

        {false && props.plan && (
          <article className="agent-card">
            <div className="card-heading">
              <Stethoscope size={18} />
              <span>主 Agent 判断</span>
              <b>{props.plan.severity}</b>
            </div>
            <p>{props.plan.summary}</p>
            <ul>
              {props.plan.todos.map((todo) => (
                <li key={todo}>{todo}</li>
              ))}
            </ul>
          </article>
        )}

        {false && props.tools.length > 0 && (
          <div className="action-stack">
            {props.tools.map((tool) => (
              <ToolActionCard tool={tool} key={tool.id} onConfirm={props.onConfirm} />
            ))}
          </div>
        )}

        {false && (props.awaitingConfirmation || props.hasPendingTools) && (
          <button className="confirm-card" onClick={() => props.onConfirm()}>
            <ShieldCheck size={18} />
            <span>确认执行这些安排</span>
          </button>
        )}
      </section>

      <section className="voice-input">
        <input
          value={props.inputText}
          onChange={(event) => props.onInputChange(event.target.value)}
          placeholder="跟安安说说哪里不舒服…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              props.onSend()
            }
          }}
        />
        <button onClick={props.onSend} disabled={props.thinking || !props.inputText.trim()}>
          <Send size={18} />
        </button>
      </section>
    </>
  )
}

function ToolActionCard({ tool, onConfirm }: { tool: ToolCard; onConfirm: () => void }) {
  const Icon =
    tool.name === 'send_feishu_message'
      ? BriefcaseBusiness
      : tool.name === 'search_nearby_clinic' || tool.name === 'route_to_clinic'
        ? MapPinned
        : tool.name === 'notify_emergency_contact'
          ? Bell
          : CheckCircle2
  return (
    <div className={`tool-card ${tool.tone}`}>
      <div className="tool-icon">
        <Icon size={20} />
      </div>
      <div>
        <h4>{toolLabel(tool.name)}</h4>
        <p>{tool.detail}</p>
        <span className="status-pill">{toolStatusLabel(tool.status)}</span>
        {tool.status === 'ready' && tool.name !== 'create_todo_list' && (
          <button className="tool-confirm-btn" onClick={onConfirm} type="button">
            确认执行
          </button>
        )}
      </div>
      <CheckCircle2 className={tool.status === 'done' ? 'done-icon visible' : 'done-icon'} size={22} />
    </div>
  )
}

function SettingsPage({
  settings,
  onUpdate,
}: {
  settings: UserSettings
  onUpdate: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void
}) {
  const [editing, setEditing] = useState<'profile' | 'contact' | 'work' | 'feishu' | 'map' | null>(null)
  const feishuConnected = Boolean(settings.feishuAppId && settings.feishuAppSecret)
  const mapConnected = Boolean(settings.tencentMapKey)

  return (
    <>
      <header className="top-bar">
        <div className="title-row">
          <ArrowLeft size={20} />
          <div>
            <h1>CareMate 安安</h1>
            <p>我的守护圈和应用绑定</p>
          </div>
        </div>
      </header>

      <section className="profile settings-profile">
        <div className="profile-photo verified">{(settings.userName || '安').slice(0, 1)}</div>
        <h2>{settings.userName || '请填写姓名'}</h2>
        <p>{settings.homeAddress || '请设置家庭住址'}</p>
      </section>

      <SettingsGroup
        title="个人档案"
        icon={<UserRound size={18} />}
        action="编辑"
        onAction={() => setEditing(editing === 'profile' ? null : 'profile')}
      >
        <SummaryRow icon={<UserRound size={18} />} title={settings.userName || '未填写姓名'} detail={settings.medicalNotes ? `病史：${settings.medicalNotes}` : '补充姓名和过往病史'} />
        {editing === 'profile' && (
          <div className="edit-panel">
            <Field label="姓名" value={settings.userName} onChange={(v) => onUpdate('userName', v)} />

            <TextField label="既往病史/用药备注" value={settings.medicalNotes} placeholder="用一两句话写清楚" onChange={(v) => onUpdate('medicalNotes', v)} />
            <SaveHint onClose={() => setEditing(null)} />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="紧急联系人"
        icon={<Heart size={18} />}
        action="添加/编辑"
        onAction={() => setEditing(editing === 'contact' ? null : 'contact')}
      >
        <ContactRow
          name={settings.emergencyContactName || '未添加紧急联系人'}
          relation={settings.emergencyPhone ? `电话：${settings.emergencyPhone}` : '用于高风险时飞书通知或电话联系'}
          tone="pink"
        />
        {editing === 'contact' && (
          <div className="edit-panel">
            <Field label="紧急联系人姓名" value={settings.emergencyContactName} placeholder="例如：妈妈 / 张伟" onChange={(v) => onUpdate('emergencyContactName', v)} />
            <Field label="紧急联系人电话" value={settings.emergencyPhone} placeholder="13800000000" onChange={(v) => onUpdate('emergencyPhone', v)} />
            <SaveHint onClose={() => setEditing(null)} />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="家庭住址"
        icon={<House size={18} />}
        action="编辑"
        onAction={() => setEditing(editing === 'work' ? null : 'work')}
      >
        <SummaryRow icon={<MapPinned size={18} />} title="家庭住址 Home Address" detail={settings.homeAddress || '设置后安安可以搜索附近医院和路线'} />
        {editing === 'work' && (
          <div className="edit-panel">
            <Field label="家庭住址" value={settings.homeAddress} placeholder="例如：深圳市南山区科技园 xx 号" onChange={(v) => onUpdate('homeAddress', v)} />

            <SaveHint onClose={() => setEditing(null)} />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="关联 APP" icon={<Link2 size={18} />}>
        <ConnectorRow icon={<BriefcaseBusiness size={24} />} name="飞书" detail={feishuConnected ? '已连接，可发送请假消息' : '未连接'} tone="blue" connected={feishuConnected} onClick={() => setEditing(editing === 'feishu' ? null : 'feishu')} />
        {editing === 'feishu' && (
          <div className="edit-panel connector-panel">
            <Field label="飞书 App ID" value={settings.feishuAppId} placeholder="cli_xxx" onChange={(v) => onUpdate('feishuAppId', v)} />
            <SecretField label="飞书 App Secret" value={settings.feishuAppSecret} placeholder="请输入飞书 App Secret" onChange={(v) => onUpdate('feishuAppSecret', v)} />
            <Field label="默认飞书联系人姓名" value={settings.leaderName} placeholder="请假时默认发送给谁" onChange={(v) => onUpdate('leaderName', v)} />
            <SaveHint onClose={() => setEditing(null)} />
          </div>
        )}
        <ConnectorRow icon={<MapPinned size={24} />} name="腾讯地图" detail={mapConnected ? '已连接，可搜索医院和路线' : '未连接'} tone="green" connected={mapConnected} onClick={() => setEditing(editing === 'map' ? null : 'map')} />
        {editing === 'map' && (
          <div className="edit-panel connector-panel">
            <SecretField label="腾讯位置服务 Key" value={settings.tencentMapKey} placeholder="请输入腾讯地图 API Key" onChange={(v) => onUpdate('tencentMapKey', v)} />
            <SaveHint onClose={() => setEditing(null)} />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="AI Agent 权限" icon={<Sparkles size={18} />}>
        <PermissionRow title="自动路线规划" detail="根据身体情况搜索附近医院和路线" checked={settings.autoRide} onChange={(value) => onUpdate('autoRide', value)} />
        <PermissionRow title="自动发消息" detail="确认后给领导或紧急联系人发送飞书消息" checked={settings.autoMessage} onChange={(value) => onUpdate('autoMessage', value)} />
      </SettingsGroup>
    </>
  )
}

function BottomNav({ page, onChange }: { page: Page; onChange: (page: Page) => void }) {
  return (
    <nav className="bottom-nav">
      <button className={page === 'assistant' ? 'active' : ''} onClick={() => onChange('assistant')}>
        <House size={18} />
        <span>安安助手</span>
      </button>
      <button className={page === 'settings' ? 'active' : ''} onClick={() => onChange('settings')}>
        <Settings size={18} />
        <span>设置</span>
      </button>
    </nav>
  )
}

function SettingsGroup(props: {
  title: string
  icon: React.ReactNode
  action?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="settings-group">
      <div className="settings-title">
        <div>
          {props.icon}
          {props.title}
        </div>
        {props.action && (
          <button onClick={props.onAction} type="button">
            <PlusCircle size={16} />
            {props.action}
          </button>
        )}
      </div>
      <div className="settings-box">{props.children}</div>
    </section>
  )
}


function SummaryRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="setting-line">
      <div className="person-avatar green">{icon}</div>
      <div>
        <b>{title}</b>
        <p>{detail}</p>
      </div>
      <Edit3 size={18} className="row-action" />
    </div>
  )
}

function MessageText({ text }: { text: string }) {
  const urlPattern = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlPattern)
  const openExternalLink = (url: string) => {
    window.location.assign(url)
  }

  return (
    <>
      {parts.map((part, index) =>
        part.match(urlPattern) ? (
          <button className="bubble-link" onClick={() => openExternalLink(part)} type="button" key={`${part}-${index}`}>
            打开地图路线
          </button>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  )
}

function ContactRow({ name, relation, tone }: { name: string; relation: string; tone: 'pink' | 'green' | 'blue' }) {
  return (
    <div className="person-row">
      <div className={`person-avatar ${tone}`}>
        <UserPlus size={18} />
      </div>
      <div>
        <b>{name}</b>
        <p>{relation}</p>
      </div>
      <Phone size={18} className="row-action" />
    </div>
  )
}

function ConnectorRow({
  icon,
  name,
  detail,
  tone,
  connected,
  onClick,
}: {
  icon: React.ReactNode
  name: string
  detail: string
  tone: 'blue' | 'green'
  connected: boolean
  onClick: () => void
}) {
  return (
    <button className="app-row app-row-button" onClick={onClick} type="button">
      <div className={`app-icon ${tone}`}>{icon}</div>
      <div>
        <b>{name}</b>
        <p className={connected ? 'connected-text' : undefined}>{detail}</p>
      </div>
      <span className={`toggle ${connected ? 'checked' : ''}`}>
        <span />
      </span>
    </button>
  )
}

function PermissionRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="permission-row">
      <div className="person-avatar green">
        <ShieldCheck size={18} />
      </div>
      <div>
        <b>{title}</b>
        <p>{detail}</p>
      </div>
      <button className={`toggle ${checked ? 'checked' : ''}`} onClick={() => onChange(!checked)} type="button" aria-label={title}>
        <span />
      </button>
    </div>
  )
}

function SaveHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="save-row">
      <span>已自动保存到后台，主界面 Agent 和工作流会读取这些设置。</span>
      <button onClick={onClose} type="button">
        <Save size={16} />
        完成
      </button>
    </div>
  )
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="leader-field">
      {label}
      <span className="secret-input">
        <input
          value={value}
          placeholder={placeholder}
          type={visible ? 'text' : 'password'}
          onChange={(event) => onChange(event.target.value)}
        />
        <button onClick={() => setVisible((current) => !current)} type="button" aria-label="显示或隐藏密钥">
          <KeyRound size={16} />
        </button>
      </span>
    </label>
  )
}
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="leader-field">
      {label}
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="leader-field">
      {label}
      <textarea
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

type RouteResultData = {
  provider?: string
  from?: string
  to?: string
  mode?: string
  distanceMeters?: number
  durationSeconds?: number
  description?: string
  fromLocation?: { lat: number; lng: number }
  toLocation?: { lat: number; lng: number }
  selectedClinic?: {
    name: string
    address?: string
    phone?: string
    location?: { lat: number; lng: number }
  }
  alternatives?: Array<unknown>
}

type SearchClinicsData = {
  clinics?: Array<{ name: string; address?: string; distanceMeters?: number }>
}

function findResultForTool(tool: ToolCard, results: ToolResult[], used: Set<string>) {
  const direct = results.find((result) => result.tool === tool.name && !used.has(result.tool))
  if (direct) return direct
  if (tool.name === 'route_to_clinic') {
    return results.find((result) => result.tool === 'search_nearby_clinic' && !used.has(result.tool))
  }
  return undefined
}

function buildExecutionSummary(results: ToolResult[], okCount: number) {
  const route = results.find((result) => result.tool === 'route_to_clinic')
  if (route?.success) return buildRouteSummary(route)

  const failedRouteOrSearch = results.find(
    (result) => !result.success && (result.tool === 'route_to_clinic' || result.tool === 'search_nearby_clinic'),
  )
  if (failedRouteOrSearch) {
    return `路线工作流没有完成：${failedRouteOrSearch.message}`
  }

  const failed = results.filter((result) => !result.success)
  const base = `执行完成（${okCount}/${results.length} 成功）。`
  if (!failed.length) return `${base} 任务结果已经更新在卡片里，请继续观察身体变化。`
  return `${base} 有 ${failed.length} 个子任务需要补充配置或稍后重试：${failed
    .map((result) => `${toolLabel(result.tool)}：${result.message}`)
    .join('；')}`
}

function buildRouteSummary(result: ToolResult) {
  const data = result.data as RouteResultData | undefined
  const clinic = data?.selectedClinic
  const mapUrl = buildTencentRouteUrl(data)
  const lines = [
    `已为你选出推荐路线：${clinic?.name || '附近医院'}`,
    clinic?.address ? `地址：${clinic.address}` : '',
    `路线：${data?.description || result.message}`,
    mapUrl ? `打开腾讯地图：${mapUrl}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function buildTencentRouteUrl(data: RouteResultData | undefined) {
  const clinic = data?.selectedClinic
  const toLocation = clinic?.location || data?.toLocation
  if (!toLocation) return ''
  const params = new URLSearchParams({
    type: 'drive',
    to: clinic?.name || data?.to || '推荐医院',
    tocoord: `${toLocation.lat},${toLocation.lng}`,
    policy: '0',
    referer: 'CareMate',
  })
  if (data?.from) params.set('from', data.from)
  if (data?.fromLocation) params.set('fromcoord', `${data.fromLocation.lat},${data.fromLocation.lng}`)
  return `https://apis.map.qq.com/uri/v1/routeplan?${params.toString()}`
}

function formatToolResult(result: ToolResult) {
  const data = result.data as (SearchClinicsData & RouteResultData) | undefined
  if (result.tool === 'search_nearby_clinic' && data?.clinics?.length) {
    return `${result.message}：${data.clinics
      .slice(0, 2)
      .map((clinic) => `${clinic.name}${clinic.distanceMeters ? `（${Math.round(clinic.distanceMeters)}米）` : ''}`)
      .join('、')}`
  }
  if (result.tool === 'route_to_clinic') {
    if (data?.selectedClinic?.name && data?.description) return `${data.selectedClinic.name}：${data.description}`
    if (data?.description) return data.description
  }
  return result.message
}

function buildReadyTools(plan: HealthPlan): ToolCard[] {
  const requested = new Set<ToolName>(plan.suggestedTools)
  if (requested.has('search_nearby_clinic') || requested.has('route_to_clinic')) {
    requested.delete('search_nearby_clinic')
    requested.add('route_to_clinic')
  }
  const ordered: ToolName[] = [
    'create_todo_list',
    'send_feishu_message',
    'route_to_clinic',
    'notify_emergency_contact',
  ]
  return ordered.filter((tool) => requested.has(tool)).map<ToolCard>((tool) => ({
    id: crypto.randomUUID(),
    name: tool,
    status: 'ready',
    detail:
      tool === 'create_todo_list'
        ? '等待记录照护待办'
        : tool === 'route_to_clinic'
          ? '等待搜索附近医院并规划推荐路线'
          : '等待你确认后执行',
    tone: toolTone(tool),
  }))
}

function applyToolResults(current: ToolCard[], results: ToolResult[]) {
  const used = new Set<string>()
  const hasRouteCard = current.some((tool) => tool.name === 'route_to_clinic')
  const hasRouteResult = results.some((result) => result.tool === 'route_to_clinic')
  const updated = current.map((tool) => {
    const matched = findResultForTool(tool, results, used)
    if (matched) used.add(matched.tool)
    return matched
      ? {
          ...tool,
          status: matched.success ? ('done' as const) : ('failed' as const),
          detail: formatToolResult(matched),
        }
      : tool
  })

  results.forEach((result) => {
    if (result.tool === 'search_nearby_clinic' && (hasRouteCard || hasRouteResult)) return
    if (!current.some((tool) => tool.name === result.tool)) {
      updated.push({
        id: crypto.randomUUID(),
        name: result.tool,
        detail: formatToolResult(result),
        status: result.success ? 'done' : 'failed',
        tone: toolTone(result.tool),
      })
    }
  })

  return updated
}

function migrateStoredMessages(
  messages: ChatMessage[],
  plan?: HealthPlan | null,
  tools?: ToolCard[],
  awaitingConfirmation?: boolean,
) {
  if (!plan || messages.some((message) => message.plan)) return messages
  const index = messages.findLastIndex((message) => message.role === 'ai')
  if (index < 0) return messages
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          plan,
          tools: tools || buildReadyTools(plan),
          awaitingConfirmation: awaitingConfirmation ?? plan.requiresConfirmation,
        }
      : message,
  )
}

function getVoiceCommand(text: string, wakeArmed: boolean) {
  const normalized = text.replace(/\s+/g, '')
  const wakeMatch = normalized.match(/^(安安同学|安安|小安安|嘿安安|你好安安)[，。,.、!！]?/)
  if (wakeMatch) {
    return {
      shouldProcess: true,
      text: normalized.slice(wakeMatch[0].length).trim(),
    }
  }
  return {
    shouldProcess: wakeArmed,
    text: wakeArmed ? text.trim() : '',
  }
}

function getRms(input: Float32Array) {
  let sum = 0
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i]
  return Math.sqrt(sum / input.length)
}

function toolTone(tool: ToolName): ToolCard['tone'] {
  if (tool === 'send_feishu_message') return 'blue'
  if (tool === 'search_nearby_clinic' || tool === 'route_to_clinic') return 'green'
  if (tool === 'notify_emergency_contact') return 'pink'
  return 'orange'
}

function toolStatusLabel(status: ToolCard['status']) {
  const labels: Record<ToolCard['status'], string> = {
    ready: '等待确认',
    running: '执行中',
    done: '已完成',
    failed: '失败',
  }
  return labels[status]
}

function toolLabel(name: ToolName) {
  const labels: Record<ToolName, string> = {
    create_todo_list: '照护待办',
    send_feishu_message: '飞书通知：领导',
    search_nearby_clinic: '腾讯地图：附近医院',
    route_to_clinic: '去医院推荐路线',
    notify_emergency_contact: '飞书通知：紧急联系人',
  }
  return labels[name]
}

function buildPlanMessage(plan: HealthPlan) {
  const risk = plan.severity === 'high' ? '偏高' : plan.severity === 'medium' ? '中等' : '较低'
  const confirm = plan.requiresConfirmation
    ? '如果你确认，我会继续执行这些事项。你可以直接说"确认执行"。'
    : '我先把照护待办记下来。'
  return `我判断你现在的风险是${risk}。${plan.summary}\n\n我建议：${plan.todos.join('、')}。\n${confirm}`
}

function resampleFloat32Array(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return input
  const ratio = sourceRate / targetRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(leftIndex + 1, input.length - 1)
    const weight = sourceIndex - leftIndex
    output[i] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight
  }

  return output
}

function floatTo16BitPcmBase64(float32Array: Float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i])
  return window.btoa(binary)
}
