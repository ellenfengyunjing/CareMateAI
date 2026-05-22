import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Bell,
  Building2,
  CalendarCheck,
  Car,
  Check,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  Home,
  MapPin,
  MessageCircle,
  Mic,
  Pill,
  Send,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRound,
  Volume2,
} from 'lucide-react'
import './style.css'

type TimelineItem = {
  id: string
  kind: 'user' | 'ai' | 'plan' | 'tool' | 'result' | 'confirm'
  title: string
  body: string
  meta?: string
  status?: 'done' | 'running' | 'waiting'
}

const initialTimeline: TimelineItem[] = [
  {
    id: 'welcome',
    kind: 'ai',
    title: 'CareMate',
    body: '我在。你可以直接说哪里不舒服，我会帮你判断情况，并把请假、买药、就医、通知家人这些事一步步安排好。',
    meta: '语音优先',
  },
]

const demoFlow: TimelineItem[] = [
  {
    id: 'u1',
    kind: 'user',
    title: '我发烧了，很晕。',
    body: '今天下午开始发烧，头很沉，站起来有点晕。',
    meta: '15:48',
  },
  {
    id: 'a1',
    kind: 'ai',
    title: '先帮你降低操作负担',
    body: '我会先确认几个关键症状：体温大概多少？有没有胸痛、呼吸困难、持续呕吐，或者意识不清？',
    status: 'done',
  },
  {
    id: 'u2',
    kind: 'user',
    title: '38.8度，没有胸痛，呼吸还好。',
    body: '就是很冷、没力气，想请假，最好能买点药。',
    meta: '15:49',
  },
  {
    id: 'assessment',
    kind: 'plan',
    title: '病情分析：moderate',
    body: 'Health Assessment Agent 判断为中等风险：发热 38.8 度、头晕乏力，但暂未出现胸痛、呼吸困难、意识异常等高危信号。',
    meta: '建议：补水休息，观察体温；若超过 39.5 度或症状加重，立即就医。',
    status: 'done',
  },
  {
    id: 'plan',
    kind: 'plan',
    title: '我建议同时处理 4 件事',
    body: '1. 给领导发病假说明。2. 搜索附近药房并下单退烧药。3. 查询附近社康。4. 通知紧急联系人你现在的状态。',
    meta: '执行前需要你确认',
    status: 'waiting',
  },
  {
    id: 'confirm',
    kind: 'confirm',
    title: '已收到确认',
    body: '好的，我会先发请假消息，再处理买药、社康和联系人通知。涉及付款和打车前会再次让你确认。',
    meta: '用户确认',
    status: 'done',
  },
  {
    id: 'leave',
    kind: 'tool',
    title: '飞书请假已发送',
    body: '已向「王经理」发送：我今天发烧 38.8 度并伴随头晕乏力，需要请病假休息和就医，如有紧急事项可电话联系。',
    meta: 'Leave Request Agent · Feishu',
    status: 'done',
  },
  {
    id: 'medicine',
    kind: 'tool',
    title: '美团买药下单中',
    body: '附近「海王星辰药房」有布洛芬缓释胶囊、电子体温计、口服补液盐。预计 20 分钟送达，付款前等待你确认。',
    meta: 'Medicine Ordering Agent · 预计 ¥46.80',
    status: 'running',
  },
  {
    id: 'clinic',
    kind: 'tool',
    title: '已找到附近社康',
    body: '南山社区健康服务中心距离 1.2km，当前可预约 16:30 全科门诊。我可以继续帮你预约并叫车。',
    meta: 'Hospital Booking Agent · 高德地图',
    status: 'done',
  },
  {
    id: 'ride',
    kind: 'tool',
    title: '滴滴车辆已匹配',
    body: '最近车辆 3 分钟到达，上车点为家庭地址楼下，目的地为南山社区健康服务中心。',
    meta: 'Transportation Agent · 等待叫车确认',
    status: 'waiting',
  },
  {
    id: 'contact',
    kind: 'tool',
    title: '已通知紧急联系人',
    body: '已向妈妈发送你的症状、当前位置和社康目的地。她回复：收到，会保持电话畅通。',
    meta: 'Emergency Contact Agent · WeChat',
    status: 'done',
  },
  {
    id: 'summary',
    kind: 'result',
    title: '我会继续守着进度',
    body: '药品预计 20 分钟送达，滴滴还有 3 分钟到达，社康 16:30 可约。现在请坐下休息，少量多次喝温水，若出现呼吸困难、胸痛、意识模糊或体温持续升高，我会立即建议急诊并通知联系人。',
    meta: '下一步建议',
    status: 'done',
  },
]

const toolCards = [
  { icon: MessageCircle, label: '飞书请假', value: '已绑定' },
  { icon: Pill, label: '美团买药', value: '需付款确认' },
  { icon: Car, label: '滴滴出行', value: 'Deep Link' },
  { icon: MapPin, label: '高德地图', value: '可用' },
]

const permissions: Array<[string, boolean]> = [
  ['自动发送工作消息', true],
  ['付款前必须确认', true],
  ['高风险时通知联系人', true],
  ['允许读取实时位置', true],
]

function getIcon(kind: TimelineItem['kind']) {
  if (kind === 'user') return UserRound
  if (kind === 'plan') return ClipboardList
  if (kind === 'tool') return Sparkles
  if (kind === 'result') return ShieldCheck
  if (kind === 'confirm') return Check
  return HeartPulse
}

function App() {
  const [timeline, setTimeline] = useState(initialTimeline)
  const [input, setInput] = useState('我发烧了，很晕。')
  const [isRunning, setIsRunning] = useState(false)
  const completedCount = useMemo(
    () => timeline.filter((item) => item.status === 'done').length,
    [timeline],
  )

  const runDemo = () => {
    setTimeline(initialTimeline)
    setIsRunning(true)
    demoFlow.forEach((item, index) => {
      window.setTimeout(() => {
        setTimeline((current) => [...current, item])
        if (index === demoFlow.length - 1) setIsRunning(false)
      }, 420 * (index + 1))
    })
  }

  const sendMessage = () => {
    if (!input.trim()) return
    runDemo()
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="brand-block">
          <div className="brand-mark">
            <HeartPulse size={27} />
          </div>
          <div>
            <p className="eyebrow">AI 病中代理人 App</p>
            <h1>CareMate 爱护AI</h1>
          </div>
        </div>
        <div className="hero-copy">
          <p>当用户生病、头晕、没力气操作手机时，AI 直接接管任务规划和现实服务执行。</p>
        </div>
        <div className="status-strip">
          <span><Volume2 size={16} />语音自然输入</span>
          <span><Stethoscope size={16} />病情风险判断</span>
          <span><Bell size={16} />主动跟进</span>
        </div>
      </section>

      <section className="workspace">
        <section className="chat-pane" aria-label="CareMate chat timeline">
          <header className="pane-header">
            <div>
              <p className="eyebrow">主聊天界面</p>
              <h2>所有执行都在同一条时间线里</h2>
            </div>
            <button className="ghost-button" onClick={runDemo} disabled={isRunning}>
              <Sparkles size={17} />
              演示流程
            </button>
          </header>

          <div className="agent-summary">
            <div>
              <span className="severity">moderate</span>
              <strong>当前风险等级</strong>
            </div>
            <div>
              <span>{completedCount}</span>
              <strong>已完成动作</strong>
            </div>
            <div>
              <span>4</span>
              <strong>可调用服务</strong>
            </div>
          </div>

          <div className="timeline">
            {timeline.map((item) => {
              const Icon = getIcon(item.kind)
              return (
                <article className={`timeline-item ${item.kind}`} key={item.id}>
                  <div className="item-icon">
                    <Icon size={18} />
                  </div>
                  <div className="message-card">
                    <div className="message-topline">
                      <h3>{item.title}</h3>
                      {item.status && <span className={`pill ${item.status}`}>{item.status}</span>}
                    </div>
                    <p>{item.body}</p>
                    {item.meta && <small>{item.meta}</small>}
                  </div>
                </article>
              )
            })}
          </div>

          <div className="composer">
            <button className="icon-button" aria-label="语音输入">
              <Mic size={20} />
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sendMessage()
              }}
              aria-label="输入症状"
            />
            <button className="send-button" onClick={sendMessage} disabled={isRunning}>
              <Send size={18} />
            </button>
          </div>
        </section>

        <aside className="settings-pane" aria-label="CareMate settings">
          <header className="pane-header compact">
            <div>
              <p className="eyebrow">设置界面</p>
              <h2>个人资料与 Agent 权限</h2>
            </div>
          </header>

          <section className="profile-block">
            <div className="avatar">陈</div>
            <div>
              <h3>陈小雨</h3>
              <p>独居 · 深圳南山 · 过敏史：青霉素</p>
            </div>
          </section>

          <section className="settings-list">
            <div className="settings-row">
              <Home size={18} />
              <div>
                <strong>家庭地址</strong>
                <span>深圳市南山区科技园</span>
              </div>
              <ChevronRight size={17} />
            </div>
            <div className="settings-row">
              <Building2 size={18} />
              <div>
                <strong>公司领导</strong>
                <span>王经理 · 飞书</span>
              </div>
              <ChevronRight size={17} />
            </div>
            <div className="settings-row">
              <UserRound size={18} />
              <div>
                <strong>紧急联系人</strong>
                <span>妈妈 · 微信</span>
              </div>
              <ChevronRight size={17} />
            </div>
            <div className="settings-row">
              <CalendarCheck size={18} />
              <div>
                <strong>默认就医偏好</strong>
                <span>优先社康，其次三甲医院</span>
              </div>
              <ChevronRight size={17} />
            </div>
          </section>

          <section className="tool-grid">
            {toolCards.map((tool) => {
              const Icon = tool.icon
              return (
                <div className="tool-card" key={tool.label}>
                  <Icon size={20} />
                  <strong>{tool.label}</strong>
                  <span>{tool.value}</span>
                </div>
              )
            })}
          </section>

          <section className="permission-card">
            <h3>Agent 权限</h3>
            {permissions.map(([label, enabled]) => (
              <label className="toggle-row" key={label}>
                <span>{label}</span>
                <input type="checkbox" defaultChecked={Boolean(enabled)} />
              </label>
            ))}
          </section>
        </aside>
      </section>
    </main>
  )
}

createRoot(document.getElementById('app')!).render(<App />)
