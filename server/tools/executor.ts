import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { env } from '../config/env.js'
import { sendMessageToUser } from '../feishu/client.js'
import { getRoute, searchNearbyClinics } from './tencentMap.js'
import {
  createTodoListSchema,
  notifyEmergencyContactSchema,
  routeToClinicSchema,
  runMobileWorkflowSchema,
  searchNearbyClinicSchema,
  sendFeishuMessageSchema,
  type ToolName,
} from './schemas.js'

const execFileAsync = promisify(execFile)

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

  if (name === 'run_mobile_workflow') {
    const args = runMobileWorkflowSchema.parse(rawArguments)
    const flow = buildMaestroFlow(args.workflow)
    await mkdir(env.MAESTRO_FLOW_DIR, { recursive: true })
    const flowPath = path.join(env.MAESTRO_FLOW_DIR, `${args.workflow.intent}-${id}.yaml`)
    await writeFile(flowPath, flow.yaml, 'utf8')

    const dryRun = (args.dry_run ?? env.MAESTRO_DRY_RUN) || !env.MAESTRO_ENABLED
    if (dryRun) {
      return {
        id,
        tool: name,
        success: true,
        message: `已生成 Maestro 手机操作脚本，等待你开启执行配置后运行：${flow.title}`,
        data: {
          dryRun: true,
          flowPath,
          yaml: flow.yaml,
          handoffRequiredAt: args.workflow.handoff_required_at,
          steps: flow.steps,
        },
      }
    }

    const { stdout, stderr } = await execFileAsync(env.MAESTRO_CLI_PATH, ['test', flowPath], {
      timeout: 180_000,
      windowsHide: true,
    })
    return {
      id,
      tool: name,
      success: true,
      message: `Maestro 手机工作流已执行到安全交接点：${flow.title}`,
      data: {
        dryRun: false,
        flowPath,
        yaml: flow.yaml,
        stdout,
        stderr,
        handoffRequiredAt: args.workflow.handoff_required_at,
        steps: flow.steps,
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

function buildMaestroFlow(workflow: z.infer<typeof runMobileWorkflowSchema>['workflow']) {
  const appId = appIdFor(workflow.target_app)
  const steps: MaestroStep[] =
    workflow.intent === 'buy_medicine'
      ? [
          { launchApp: true },
          { tapOn: '\u4e70\u836f' },
          { tapOn: '\u641c\u7d22' },
          { setClipboard: workflow.medicine_name || '\u611f\u5192\u836f' },
          { pasteText: true },
          { tapOn: workflow.medicine_name || '\u611f\u5192\u836f' },
          { assertVisible: '\u652f\u4ed8' },
        ]
      : workflow.intent === 'book_ride'
        ? [
            { launchApp: true },
            { tapOn: '\u4f60\u8981\u53bb\u54ea\u513f' },
            { setClipboard: workflow.destination || '\u533b\u9662' },
            { pasteText: true },
            { tapOn: workflow.destination || '\u533b\u9662' },
            { assertVisible: '\u786e\u8ba4\u547c\u53eb' },
          ]
        : workflow.intent === 'call_phone'
          ? [
              { launchApp: { clearState: true } },
              { inputText: workflow.phone_number || '120' },
              { tapOn: '\u8054\u901a' },
              { assertVisible: workflow.phone_number || '120' },
            ]
          : [
              { launchApp: true },
              { assertVisible: workflow.goal },
            ]

  return {
    title: workflow.goal,
    steps,
    yaml: toMaestroYaml(appId, workflow.goal, steps),
  }
}
function appIdFor(targetApp: string) {
  const appIds: Record<string, string> = {
    meituan: 'com.sankuai.meituan',
    didi: 'com.sdu.didi.psnger',
    phone: 'com.android.contacts',
    amap: 'com.autonavi.minimap',
    other: 'com.android.settings',
  }
  return appIds[targetApp] || appIds.other
}

type MaestroStep = Record<string, string | boolean | Record<string, string | boolean>>

function toMaestroYaml(appId: string, name: string, steps: MaestroStep[]) {
  const lines = [`appId: ${appId}`, `name: ${escapeYamlValue(name)}`, '---']
  for (const step of steps) {
    const [command, value] = Object.entries(step)[0]
    if (value === true) {
      lines.push(`- ${command}`)
    } else if (typeof value === 'object' && value) {
      lines.push(`- ${command}:`)
      for (const [key, nestedValue] of Object.entries(value)) {
        lines.push(`    ${key}: ${typeof nestedValue === 'boolean' ? nestedValue : escapeYamlValue(String(nestedValue))}`)
      }
    } else {
      lines.push(`- ${command}: ${escapeYamlValue(String(value))}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function escapeYamlValue(value: string) {
  return JSON.stringify(value)
}
