import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../feishu/client.js', () => ({
  searchUserByName: vi.fn(async (name: string) => ({ name, openId: `ou_for_${name}` })),
  sendMessage: vi.fn(async () => ({ messageId: 'msg_123', createTime: '0' })),
  getOpenIdByBatchGetId: vi.fn(async (target: { name: string; openId?: string }) => ({
    name: target.name,
    openId: target.openId || `ou_for_${target.name}`,
  })),
}))

vi.mock('../tencentMap.js', () => ({
  searchNearbyClinics: vi.fn(async () => [
    {
      name: '南山社区健康服务中心',
      address: '深圳市南山区粤海街道',
      distanceMeters: 600,
      category: '医疗',
      location: { lat: 22.5, lng: 113.9 },
    },
  ]),
  getRoute: vi.fn(async () => ({
    mode: 'walking' as const,
    distanceMeters: 700,
    durationSeconds: 540,
    description: '步行 700米，约 9 分钟',
  })),
}))

import { executeTool } from '../executor.js'

describe('executeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws on unknown tool', async () => {
    await expect(executeTool('not_a_tool', {})).rejects.toThrow(/Unknown tool/)
  })

  it('create_todo_list returns success without external calls', async () => {
    const result = await executeTool('create_todo_list', {
      todos: ['多喝水', '休息'],
      intent: { intent: 'health_check', severity: 'low', summary: '感冒', todos: ['多喝水'] },
    })
    expect(result.success).toBe(true)
    expect(result.tool).toBe('create_todo_list')
    expect((result.data as { todos: string[] }).todos).toEqual(['多喝水', '休息'])
  })

  it('send_feishu_message goes through mock provider when FEISHU_MOCK=true', async () => {
    const result = await executeTool('send_feishu_message', {
      receiver: '张总',
      message_text: '请假说明',
    })
    expect(result.success).toBe(true)
    expect((result.data as { provider: string }).provider).toBe('mock')
  })

  it('notify_emergency_contact uses Feishu mock to deliver to family', async () => {
    const result = await executeTool('notify_emergency_contact', {
      contact_name: '妈妈',
      message_text: '关切性通知',
    })
    expect(result.success).toBe(true)
    expect(result.tool).toBe('notify_emergency_contact')
  })

  it('search_nearby_clinic returns clinics from tencent map', async () => {
    const result = await executeTool('search_nearby_clinic', {
      location: '深圳市南山区',
      severity: 'medium',
      symptom_summary: '发烧 38.5',
    })
    expect(result.success).toBe(true)
    const data = result.data as { clinics: Array<{ name: string }> }
    expect(data.clinics[0].name).toBe('南山社区健康服务中心')
  })

  it('route_to_clinic returns route description', async () => {
    const result = await executeTool('route_to_clinic', {
      from: '家',
      to: '社康',
      mode: 'walking',
    })
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/步行/)
  })

  it('rejects malformed args via zod', async () => {
    await expect(
      executeTool('send_feishu_message', { receiver: '', message_text: 'x' }),
    ).rejects.toBeTruthy()
  })
})
