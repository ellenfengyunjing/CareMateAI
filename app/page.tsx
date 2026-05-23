'use client'

import { useRef, useState } from 'react'
import {
  Activity,
  Bell,
  Bug,
  Check,
  ClipboardList,
  HeartPulse,
  Mic,
  MicOff,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Volume2,
} from 'lucide-react'

type ChatMessage = {
  id: string
  role: 'user' | 'ai' | 'system'
  text: string
}

type ToolEvent = {
  id: string
  name: string
  status: 'running' | 'success' | 'failed'
  detail: string
}

type AgentIntent = {
  intent: 'health_check' | 'leave_request' | 'emergency' | 'daily_help'
  severity: 'low' | 'medium' | 'high'
  summary: string
  todos: string[]
}

const demoText = '我发烧39度，有点头晕，今天可能去不了公司'

export default function Home() {
  const [connected, setConnected] = useState(false)
  const [recording, setRecording] = useState(false)
  const [debugMode, setDebugMode] = useState(true)
  const [leaderName, setLeaderName] = useState('Ellen Feng')
  const [emergencyPhone, setEmergencyPhone] = useState('13800000000')
  const [inputText, setInputText] = useState(demoText)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'ai',
      text: '我在。你可以直接说哪里不舒服，我会实时判断情况，并在需要时调用工具帮你请假、通知联系人或创建照护待办。',
    },
  ])
  const [tools, setTools] = useState<ToolEvent[]>([])
  const [intent, setIntent] = useState<AgentIntent | null>(null)
  const [debugEvents, setDebugEvents] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const nextPlayTimeRef = useRef(0)
  const currentAiMessageIdRef = useRef<string | null>(null)

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(`ws://${window.location.hostname}:8787/ws/realtime`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'session.start',
          leaderName,
          emergencyPhone,
          debug: debugMode,
        }),
      )
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      handleRealtimeEvent(data)
    }

    ws.onclose = () => {
      setConnected(false)
      stopRecording()
    }

    ws.onerror = () => {
      addSystemMessage('Realtime 连接失败，请确认后端服务已经启动。')
    }
  }

  const handleRealtimeEvent = (event: any) => {
    if (event.type === 'status') {
      setConnected(event.status === 'connected')
      addDebug(`status: ${event.status}`)
    }

    if (event.type === 'transcript.user') {
      addMessage('user', event.text)
    }

    if (event.type === 'transcript.ai.delta') {
      appendAiDelta(event.text)
    }

    if (event.type === 'transcript.ai.done') {
      currentAiMessageIdRef.current = null
    }

    if (event.type === 'audio.delta') {
      playPcm16(event.audio)
    }

    if (event.type === 'tool.started') {
      setTools((current) => [
        {
          id: crypto.randomUUID(),
          name: event.name,
          status: 'running',
          detail: JSON.stringify(event.arguments, null, 2),
        },
        ...current,
      ])
    }

    if (event.type === 'tool.succeeded') {
      setTools((current) =>
        current.map((tool, index) =>
          index === 0 && tool.name === event.name
            ? { ...tool, status: 'success', detail: event.result.message }
            : tool,
        ),
      )
      const toolIntent = event.result?.data?.intent
      if (toolIntent?.intent) setIntent(toolIntent)
    }

    if (event.type === 'tool.failed') {
      setTools((current) =>
        current.map((tool, index) =>
          index === 0 && tool.name === event.name
            ? { ...tool, status: 'failed', detail: event.message }
            : tool,
        ),
      )
    }

    if (event.type === 'debug') {
      addDebug(`${event.event.type}${event.event.name ? ` · ${event.event.name}` : ''}`)
    }

    if (event.type === 'error') {
      addSystemMessage(event.message)
    }
  }

  const startRecording = async () => {
    connect()
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
      const input = event.inputBuffer.getChannelData(0)
      ws.send(
        JSON.stringify({
          type: 'audio.append',
          audio: floatTo16BitPcmBase64(input),
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
  }

  const stopRecording = () => {
    if (recording) {
      wsRef.current?.send(JSON.stringify({ type: 'audio.commit' }))
    }
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    setRecording(false)
  }

  const sendText = () => {
    connect()
    if (!inputText.trim()) return
    addMessage('user', inputText)
    window.setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type: 'text.send', text: inputText }))
    }, 350)
  }

  const appendAiDelta = (text: string) => {
    setMessages((current) => {
      const activeId = currentAiMessageIdRef.current
      if (activeId) {
        return current.map((message) =>
          message.id === activeId ? { ...message, text: `${message.text}${text}` } : message,
        )
      }

      const id = crypto.randomUUID()
      currentAiMessageIdRef.current = id
      return [...current, { id, role: 'ai', text }]
    })
  }

  const addMessage = (role: ChatMessage['role'], text: string) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }])
  }

  const addSystemMessage = (text: string) => addMessage('system', text)

  const addDebug = (line: string) => {
    setDebugEvents((current) => [line, ...current].slice(0, 20))
  }

  const playPcm16 = async (base64Audio: string) => {
    const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 })
    audioContextRef.current = audioContext
    const pcm = base64ToInt16Array(base64Audio)
    const buffer = audioContext.createBuffer(1, pcm.length, 24000)
    const channel = buffer.getChannelData(0)

    for (let i = 0; i < pcm.length; i += 1) {
      channel[i] = pcm[i] / 32768
    }

    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(audioContext.destination)

    const startAt = Math.max(audioContext.currentTime, nextPlayTimeRef.current)
    source.start(startAt)
    nextPlayTimeRef.current = startAt + buffer.duration
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="brand-block">
          <div className="brand-mark">
            <HeartPulse size={27} />
          </div>
          <div>
            <p className="eyebrow">OpenAI Realtime · AI 病中代理人</p>
            <h1>CareMate 爱护AI</h1>
          </div>
        </div>
        <p className="hero-copy">语音输入、实时回复、工具调用可视化：让 AI 在用户身体不舒服时替用户处理请假和照护安排。</p>
        <div className="status-strip">
          <span><Volume2 size={16} />低延迟语音</span>
          <span><Stethoscope size={16} />病情判断</span>
          <span><Bell size={16} />工具执行</span>
        </div>
      </section>

      <section className="workspace">
        <section className="chat-pane">
          <header className="pane-header">
            <div>
              <p className="eyebrow">实时对话</p>
              <h2>{connected ? 'Realtime 已连接' : '点击开始连接 CareMate'}</h2>
            </div>
            <button className={`voice-button ${recording ? 'recording' : ''}`} onClick={recording ? stopRecording : startRecording}>
              {recording ? <MicOff size={20} /> : <Mic size={20} />}
              {recording ? '停止' : '语音'}
            </button>
          </header>

          <div className="chat-scroll">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-icon">{message.role === 'ai' ? <Sparkles size={17} /> : message.role === 'user' ? <Activity size={17} /> : <ShieldCheck size={17} />}</div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>

          <footer className="composer">
            <input value={inputText} onChange={(event) => setInputText(event.target.value)} />
            <button className="send-button" onClick={sendText}>
              <Send size={18} />
            </button>
          </footer>
        </section>

        <aside className="settings-pane">
          <section className="panel">
            <div className="panel-title">
              <Settings size={18} />
              <h3>用户配置</h3>
            </div>
            <label>
              领导姓名
              <input value={leaderName} onChange={(event) => setLeaderName(event.target.value)} />
            </label>
            <label>
              紧急联系人电话
              <input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} />
            </label>
            <label className="toggle-row">
              Debug 链路
              <input type="checkbox" checked={debugMode} onChange={(event) => setDebugMode(event.target.checked)} />
            </label>
          </section>

          <section className="panel">
            <div className="panel-title">
              <ClipboardList size={18} />
              <h3>AI 判断</h3>
            </div>
            {intent ? (
              <div className="intent-card">
                <strong>{intent.intent} · {intent.severity}</strong>
                <p>{intent.summary}</p>
                <ul>{intent.todos.map((todo) => <li key={todo}>{todo}</li>)}</ul>
              </div>
            ) : (
              <p className="muted">等待用户说出生病或求助情况后展示 intent / severity / todos。</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              <Check size={18} />
              <h3>工具调用</h3>
            </div>
            <div className="tool-list">
              {tools.length === 0 && <p className="muted">工具调用会实时显示在这里。</p>}
              {tools.map((tool) => (
                <article className={`tool-item ${tool.status}`} key={tool.id}>
                  <strong>{tool.name}</strong>
                  <span>{tool.status}</span>
                  <p>{tool.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <Bug size={18} />
              <h3>Debug 日志</h3>
            </div>
            <div className="debug-list">
              {debugEvents.map((event, index) => <code key={`${event}-${index}`}>{event}</code>)}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}

function floatTo16BitPcmBase64(float32Array: Float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return arrayBufferToBase64(buffer)
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

function base64ToInt16Array(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Int16Array(bytes.buffer)
}

