'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  Car,
  CheckCircle2,
  ChevronRight,
  Heart,
  HeartPulse,
  House,
  Link2,
  MapPinned,
  Mic,
  MicOff,
  Pill,
  PlusCircle,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react'

type Page = 'assistant' | 'settings'
type Role = 'user' | 'ai' | 'system'

type ChatMessage = {
  id: string
  role: Role
  text: string
}

type HealthPlan = {
  intent: 'health_check' | 'leave_request' | 'emergency' | 'daily_help'
  severity: 'low' | 'medium' | 'high'
  summary: string
  todos: string[]
  recommendedActions: string[]
  requiresConfirmation: boolean
  suggestedTools: string[]
  assistantMessage: string
  leaveMessageText: string | null
}

type ToolCard = {
  id: string
  name: string
  detail: string
  status: 'ready' | 'running' | 'done' | 'failed'
  tone: 'blue' | 'green' | 'orange' | 'pink'
}

const initialMessages: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'ai',
    text: '安安在听。你不用操作手机，直接告诉我哪里不舒服，我会先判断情况，再把建议和可执行事项告诉你。',
  },
]

export default function Home() {
  const [page, setPage] = useState<Page>('assistant')
  const [listening, setListening] = useState(true)
  const [recording, setRecording] = useState(false)
  const [inputText, setInputText] = useState('我发烧39度，有点头晕，今天可能去不了公司')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [plan, setPlan] = useState<HealthPlan | null>(null)
  const [tools, setTools] = useState<ToolCard[]>([])
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [userName, setUserName] = useState('陈林夕')
  const [leaderName, setLeaderName] = useState('Ellen Feng')
  const [leaderOpenId, setLeaderOpenId] = useState('')
  const [homeAddress, setHomeAddress] = useState('深圳市南山区科技园')
  const [emergencyContactName, setEmergencyContactName] = useState('Sarah Miller')
  const [emergencyPhone, setEmergencyPhone] = useState('13800000000')

  const wsRef = useRef<WebSocket | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const currentAiMessageIdRef = useRef<string | null>(null)

  const userSettings = useMemo(
    () => ({
      userName,
      leaderName,
      leaderOpenId,
      homeAddress,
      emergencyContactName,
      emergencyPhone,
    }),
    [emergencyContactName, emergencyPhone, homeAddress, leaderName, leaderOpenId, userName],
  )

  useEffect(() => {
    const saved = window.localStorage.getItem('caremate-settings')
    if (!saved) return
    try {
      const parsed = JSON.parse(saved)
      if (parsed.userName) setUserName(parsed.userName)
      if (parsed.leaderName) setLeaderName(parsed.leaderName)
      if (parsed.leaderOpenId) setLeaderOpenId(parsed.leaderOpenId)
      if (parsed.homeAddress) setHomeAddress(parsed.homeAddress)
      if (parsed.emergencyContactName) setEmergencyContactName(parsed.emergencyContactName)
      if (parsed.emergencyPhone) setEmergencyPhone(parsed.emergencyPhone)
    } catch {
      window.localStorage.removeItem('caremate-settings')
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('caremate-settings', JSON.stringify(userSettings))
  }, [userSettings])

  const statusText = useMemo(() => {
    if (recording) return '正在倾听...'
    if (awaitingConfirmation) return '等待你确认执行'
    if (tools.some((tool) => tool.status === 'running')) return '正在替你处理'
    return '语音模式已开启'
  }, [awaitingConfirmation, recording, tools])

  const connectRealtime = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(`ws://${window.location.hostname}:8787/ws/realtime`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'session.start',
          leaderName,
          emergencyPhone,
          debug: false,
        }),
      )
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'transcript.user') {
        void handleUserText(data.text)
      }
      if (data.type === 'transcript.ai.delta') {
        appendAiDelta(data.text)
      }
      if (data.type === 'transcript.ai.done') {
        currentAiMessageIdRef.current = null
      }
      if (data.type === 'error') {
        addMessage('system', '实时语音暂时连不上，我会先用本地 Agent 流程继续帮你处理。')
      }
    }
  }

  const toggleVoice = async () => {
    if (recording) {
      stopRecording()
      return
    }

    connectRealtime()
    setListening(true)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const audioContext = new AudioContext({ sampleRate: 24000 })
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      processor.onaudioprocess = (event) => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        ws.send(
          JSON.stringify({
            type: 'audio.append',
            audio: floatTo16BitPcmBase64(event.inputBuffer.getChannelData(0)),
          }),
        )
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      mediaStreamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      processorRef.current = processor
      setRecording(true)
    } catch {
      addMessage('system', '没有拿到麦克风权限。你也可以先用下方测试输入模拟语音。')
    }
  }

  const stopRecording = () => {
    wsRef.current?.send(JSON.stringify({ type: 'audio.commit' }))
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    setRecording(false)
  }

  const handleUserText = async (text: string) => {
    const normalized = text.trim()
    if (!normalized) return

    addMessage('user', normalized)

    if (/确认|可以|执行|发送|帮我发|就这样/.test(normalized) && plan && awaitingConfirmation) {
      await executePlan(plan)
      return
    }

    const response = await fetch('/api/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: normalized, settings: userSettings }),
    })
    const data = await response.json()
    const nextPlan = data.plan as HealthPlan
    setPlan(nextPlan)
    setAwaitingConfirmation(nextPlan.requiresConfirmation)
    setTools(buildReadyTools(nextPlan))
    addMessage('ai', nextPlan.assistantMessage || buildPlanMessage(nextPlan))
  }

  const executePlan = async (targetPlan: HealthPlan) => {
    setAwaitingConfirmation(false)
    setTools((current) => current.map((tool) => ({ ...tool, status: 'running' })))
    addMessage('ai', '好的，我现在开始执行。你先坐下休息，手机这边我来处理。')

    const response = await fetch('/api/agent/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: targetPlan,
        settings: userSettings,
      }),
    })
    const data = await response.json()
    const results = data.results || []

    setTools((current) =>
      current.map((tool) => {
        const matched = results.find((result: any) => result.tool === tool.name)
        return matched
          ? { ...tool, status: matched.success ? 'done' : 'failed', detail: matched.message }
          : tool
      }),
    )

    addMessage('ai', '我已经处理好了：请假消息、照护待办和附近社康路线都已整理。接下来请少量多次喝水，继续观察体温变化。')
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

  const addMessage = (role: Role, text: string) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }])
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
          listening={listening}
          inputText={inputText}
          awaitingConfirmation={awaitingConfirmation}
          onInputChange={setInputText}
          onVoice={toggleVoice}
          onSend={() => void handleUserText(inputText)}
          onConfirm={() => plan && void executePlan(plan)}
        />
      ) : (
        <SettingsPage
          userName={userName}
          leaderName={leaderName}
          leaderOpenId={leaderOpenId}
          homeAddress={homeAddress}
          emergencyContactName={emergencyContactName}
          emergencyPhone={emergencyPhone}
          onUserNameChange={setUserName}
          onLeaderChange={setLeaderName}
          onLeaderOpenIdChange={setLeaderOpenId}
          onHomeAddressChange={setHomeAddress}
          onEmergencyContactNameChange={setEmergencyContactName}
          onEmergencyPhoneChange={setEmergencyPhone}
        />
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
  listening: boolean
  inputText: string
  awaitingConfirmation: boolean
  onInputChange: (text: string) => void
  onVoice: () => void
  onSend: () => void
  onConfirm: () => void
}) {
  return (
    <>
      <header className="top-bar">
        <div>
          <h1>CareMate 安安</h1>
          <p>你的独居陪护小助手</p>
        </div>
        <div className="mini-avatar">
          <HeartPulse size={20} />
        </div>
      </header>

      <section className="intro">
        <h2>CareMate</h2>
        <p>你只需要说话，剩下的我来安排</p>
      </section>

      <section className="orb-section">
        <button className={`voice-orb ${props.recording ? 'active' : ''}`} onClick={props.onVoice} aria-label="语音沟通">
          <span className="orb-aura" />
          <span className="orb-core">{props.recording ? <MicOff size={42} /> : <Mic size={42} />}</span>
        </button>
        <p className="listen-label">{props.statusText}</p>
      </section>

      <section className="conversation">
        {props.messages.map((message) => (
          <article className={`bubble-row ${message.role}`} key={message.id}>
            {message.role !== 'user' && (
              <div className="assistant-mark">
                <Sparkles size={16} />
              </div>
            )}
            <div className="bubble">{message.text}</div>
          </article>
        ))}

        {props.plan && (
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

        {props.tools.length > 0 && (
          <div className="action-stack">
            {props.tools.map((tool) => (
              <ToolActionCard tool={tool} key={tool.id} />
            ))}
          </div>
        )}

        {props.awaitingConfirmation && (
          <button className="confirm-card" onClick={props.onConfirm}>
            <ShieldCheck size={18} />
            <span>确认执行这些安排</span>
          </button>
        )}
      </section>

      <section className="voice-input">
        <input value={props.inputText} onChange={(event) => props.onInputChange(event.target.value)} />
        <button onClick={props.onSend}>
          <Send size={18} />
        </button>
      </section>
    </>
  )
}

function ToolActionCard({ tool }: { tool: ToolCard }) {
  const Icon = tool.name === 'send_feishu_message' ? BriefcaseBusiness : tool.name === 'search_nearby_clinic' ? MapPinned : tool.name === 'send_sms_emergency' ? Bell : CheckCircle2
  return (
    <div className={`tool-card ${tool.tone}`}>
      <div className="tool-icon">
        <Icon size={20} />
      </div>
      <div>
        <h4>{toolLabel(tool.name)}</h4>
        <p>{tool.detail}</p>
      </div>
      <CheckCircle2 className={tool.status === 'done' ? 'done-icon visible' : 'done-icon'} size={22} />
    </div>
  )
}

function SettingsPage(props: {
  userName: string
  leaderName: string
  leaderOpenId: string
  homeAddress: string
  emergencyContactName: string
  emergencyPhone: string
  onUserNameChange: (value: string) => void
  onLeaderChange: (value: string) => void
  onLeaderOpenIdChange: (value: string) => void
  onHomeAddressChange: (value: string) => void
  onEmergencyContactNameChange: (value: string) => void
  onEmergencyPhoneChange: (value: string) => void
}) {
  return (
    <>
      <header className="top-bar">
        <div className="title-row">
          <ArrowLeft size={20} />
          <div>
            <h1>CareMate 安安</h1>
            <p>我的守护圈</p>
          </div>
        </div>
      </header>

      <section className="profile">
        <div className="profile-photo">陈</div>
        <h2>{props.userName}</h2>
        <p>独居 · 深圳南山 · 青霉素过敏</p>
      </section>

      <SettingsGroup title="紧急联系人" icon={<Heart size={18} />} action="添加">
        <PersonRow name={props.emergencyContactName} desc={props.emergencyPhone} tone="blue" />
        <PersonRow name="Dr. James Wong" desc="私人医生" tone="orange" />
        <label className="leader-field">
          紧急联系人姓名
          <input value={props.emergencyContactName} onChange={(event) => props.onEmergencyContactNameChange(event.target.value)} />
        </label>
        <label className="leader-field">
          紧急联系人电话
          <input value={props.emergencyPhone} onChange={(event) => props.onEmergencyPhoneChange(event.target.value)} />
        </label>
      </SettingsGroup>

      <SettingsGroup title="AI Agent模式" icon={<Sparkles size={18} />}>
        <div className="setting-line">
          <div>
            <b>自主模式</b>
            <p>开启后，Agent 可以在确认后自主执行任务</p>
          </div>
          <Toggle checked />
        </div>
      </SettingsGroup>

      <SettingsGroup title="关联APP" icon={<Link2 size={18} />}>
        <AppRow icon={<Pill size={20} />} name="美团" status="已连接" checked tone="yellow" />
        <AppRow icon={<Car size={20} />} name="滴滴" status="已连接" checked tone="orange" />
        <AppRow icon={<BriefcaseBusiness size={20} />} name="飞书" status="已连接" checked tone="blue" />
        <AppRow icon={<MapPinned size={20} />} name="高德地图" status="已连接" checked tone="green" />
      </SettingsGroup>

      <SettingsGroup title="AI Agent权限" icon={<ShieldCheck size={18} />}>
        <PermissionRow title="自动打车" desc="根据身体情况安排去附近医院" checked />
        <PermissionRow title="自动发消息" desc="确认后发消息给领导或紧急联系人" checked />
        <label className="leader-field">
          用户姓名
          <input value={props.userName} onChange={(event) => props.onUserNameChange(event.target.value)} />
        </label>
        <label className="leader-field">
          默认领导
          <input value={props.leaderName} onChange={(event) => props.onLeaderChange(event.target.value)} />
        </label>
        <label className="leader-field">
          领导飞书 open_id（可选）
          <input value={props.leaderOpenId} onChange={(event) => props.onLeaderOpenIdChange(event.target.value)} placeholder="ou_xxx" />
        </label>
        <label className="leader-field">
          家庭住址
          <input value={props.homeAddress} onChange={(event) => props.onHomeAddressChange(event.target.value)} />
        </label>
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

function SettingsGroup(props: { title: string; icon: React.ReactNode; action?: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <div className="settings-title">
        <div>{props.icon}{props.title}</div>
        {props.action && <button><PlusCircle size={16} />{props.action}</button>}
      </div>
      <div className="settings-box">{props.children}</div>
    </section>
  )
}

function PersonRow({ name, desc, tone }: { name: string; desc: string; tone: string }) {
  return (
    <div className="person-row">
      <div className={`person-avatar ${tone}`}><UserRound size={18} /></div>
      <div><b>{name}</b><p>{desc}</p></div>
      <ChevronRight size={18} />
    </div>
  )
}

function AppRow(props: { icon: React.ReactNode; name: string; status: string; checked?: boolean; tone: string }) {
  return (
    <div className="app-row">
      <div className={`app-icon ${props.tone}`}>{props.icon}</div>
      <div><b>{props.name}</b><p>{props.status}</p></div>
      <Toggle checked={props.checked} />
    </div>
  )
}

function PermissionRow(props: { title: string; desc: string; checked?: boolean }) {
  return (
    <div className="setting-line">
      <div><b>{props.title}</b><p>{props.desc}</p></div>
      <Toggle checked={props.checked} />
    </div>
  )
}

function Toggle({ checked }: { checked?: boolean }) {
  return <span className={`toggle ${checked ? 'checked' : ''}`}><span /></span>
}

function buildReadyTools(plan: HealthPlan): ToolCard[] {
  return plan.suggestedTools.map((tool) => ({
    id: crypto.randomUUID(),
    name: tool,
    status: tool === 'create_todo_list' ? 'done' : 'ready',
    detail: tool === 'create_todo_list' ? '已生成照护待办' : '等待你确认后执行',
    tone: tool === 'send_feishu_message' ? 'blue' : tool === 'search_nearby_clinic' ? 'green' : tool === 'send_sms_emergency' ? 'pink' : 'orange',
  }))
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    create_todo_list: '照护待办',
    send_feishu_message: '飞书通知：领导',
    search_nearby_clinic: '高德地图：附近社康',
    send_sms_emergency: '短信通知：紧急联系人',
  }
  return labels[name] || name
}

function buildPlanMessage(plan: HealthPlan) {
  const risk = plan.severity === 'high' ? '偏高' : plan.severity === 'medium' ? '中等' : '较低'
  const confirm = plan.requiresConfirmation ? '如果你确认，我会继续执行请假和路线查询。你可以直接说“确认执行”。' : '我先把照护待办记下来。'
  return `我判断你现在的风险是${risk}。${plan.summary}\n\n我建议：${plan.todos.join('、')}。\n${confirm}`
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
