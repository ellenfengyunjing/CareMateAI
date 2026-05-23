# CareMate AI

CareMate（爱护AI）是一个第一阶段可运行的 AI 病中代理人 Demo。

- Next.js 前端：实时语音按钮、对话 UI、AI 判断、tool calling 可视化、debug 日志。
- Node.js 后端：REST API、WebSocket Realtime 代理、tool router、executor、日志记录。
- OpenAI Realtime API：浏览器麦克风音频通过本地 WebSocket 发送到后端，由后端连接 OpenAI Realtime。
- 工具：飞书消息、紧急短信、待办事项。飞书和短信默认 mock，避免测试时误发。

## 项目结构

```txt
app/
  layout.tsx
  page.tsx
  globals.css
server/
  agents/
    healthAgent.ts
    prompts.ts
  api/
    leave.ts
    tools.ts
  config/
    env.ts
  feishu/
    client.ts
  logging/
    logger.ts
  realtime/
    server.ts
  tools/
    executor.ts
    schemas.ts
  index.ts
prisma/
  schema.prisma
.env.example
README.md
```

## 环境变量

复制 `.env.example` 为 `.env`，填入需要的 key：

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_REALTIME_MODEL=gpt-realtime
FEISHU_MOCK=true
SMS_MOCK=true
DATABASE_URL="file:./dev.db"
PORT=8787
```

说明：

- `FEISHU_MOCK=true` 时，`send_feishu_message` 不会真实发送，只返回 mock 成功。
- 要真实发送飞书消息，将 `FEISHU_MOCK=false`，并确保飞书通讯录权限和消息权限已发布生效。
- `SMS_MOCK=true` 时，短信只模拟发送。

## 启动

```bash
npm install
npm run dev
```

默认端口：

- Next.js 前端：http://localhost:3000
- API / WebSocket 后端：http://localhost:8787
- Realtime WebSocket：ws://localhost:8787/ws/realtime

## 核心交互

用户可以点击语音按钮说：

> 我发烧39度，有点头晕，今天可能去不了公司

系统流程：

1. 浏览器麦克风采集语音。
2. 前端将音频转成 PCM16，流式发送到后端 WebSocket。
3. 后端连接 OpenAI Realtime API。
4. AI 判断 intent / severity / todos。
5. AI 需要执行任务时调用工具：
   - `create_todo_list`
   - `send_feishu_message`
   - `send_sms_emergency`
6. 后端 tool router 执行工具，并把结果回传给 Realtime API。
7. AI 用语音和文字回复用户。

## REST 工具测试

```bash
curl -X POST http://localhost:8787/api/tools/execute \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"send_feishu_message\",\"arguments\":{\"receiver\":\"Ellen Feng\",\"message_text\":\"我今天发烧头晕，想请一天病假休息观察，谢谢理解。\"}}"
```

## 日志

Realtime 和 tool calling 事件会写入：

```txt
logs/realtime.ndjson
```

该目录不会提交到 Git。
