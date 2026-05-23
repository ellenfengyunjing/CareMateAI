import { describe, expect, it, vi, beforeEach } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: createMock,
        },
      }
    },
  }
})

import { runAgentTurn } from '../careAgent.js'

describe('runAgentTurn', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('returns a follow-up message when agent replies with text', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: '症状持续多久了？有发烧吗？', tool_calls: [] } }],
    })
    const result = await runAgentTurn({
      messages: [{ role: 'user', content: '我有点头疼' }],
      settings: {},
    })
    expect(result.kind).toBe('message')
    if (result.kind === 'message') {
      expect(result.text).toContain('症状持续多久')
    }
  })

  it('returns a plan when agent calls propose_plan tool', async () => {
    const args = {
      intent: 'leave_request',
      severity: 'medium',
      summary: '感冒发烧需要请假',
      todos: ['休息', '补水'],
      recommendedActions: ['今天少活动'],
      requiresConfirmation: true,
      suggestedTools: ['create_todo_list', 'send_feishu_message'],
      assistantMessage: '我建议先请假并休息，确认后我去发飞书。',
      leaveMessageText: '王总，我今天身体不太舒服…',
    }
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'propose_plan', arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    })
    const result = await runAgentTurn({
      messages: [
        { role: 'user', content: '我发烧 38.5，去不了公司' },
        { role: 'assistant', content: '持续多久？' },
        { role: 'user', content: '从早上开始' },
      ],
      settings: { leaderName: '王总', emergencyContactFeishuName: '妈妈' },
    })
    expect(result.kind).toBe('plan')
    if (result.kind === 'plan') {
      expect(result.plan.severity).toBe('medium')
      expect(result.plan.suggestedTools).toContain('send_feishu_message')
      expect(result.plan.requiresConfirmation).toBe(true)
    }
  })

  it('throws when OpenAI is unavailable and local fallback is disabled', async () => {
    createMock.mockRejectedValueOnce(new Error('upstream timeout'))
    await expect(
      runAgentTurn({
        messages: [{ role: 'user', content: '我胸口疼喘不上气' }],
        settings: {},
      }),
    ).rejects.toThrow(/主模型暂时不可用/)
  })
})
