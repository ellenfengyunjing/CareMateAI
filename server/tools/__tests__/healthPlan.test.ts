import { describe, expect, it } from 'vitest'
import { createLocalHealthPlan } from '../healthPlan.js'

describe('createLocalHealthPlan', () => {
  it('classifies a mild cold as low severity without external tools', () => {
    const plan = createLocalHealthPlan('我感冒了，喉咙有点痛')
    expect(plan.severity).toBe('low')
    expect(plan.intent).toBe('health_check')
    expect(plan.suggestedTools).toEqual(['create_todo_list'])
    expect(plan.requiresConfirmation).toBe(false)
  })

  it('promotes to medium when high fever is mentioned', () => {
    const plan = createLocalHealthPlan('我发烧 39 度，挺难受')
    expect(plan.severity).toBe('medium')
    expect(plan.suggestedTools).toContain('search_nearby_clinic')
  })

  it('escalates to high when high fever combines with dizziness', () => {
    const plan = createLocalHealthPlan('我高烧 40 度，还头晕得很')
    expect(plan.severity).toBe('high')
    expect(plan.suggestedTools).toContain('notify_emergency_contact')
    expect(plan.suggestedTools).toContain('search_nearby_clinic')
    expect(plan.requiresConfirmation).toBe(true)
  })

  it('marks emergency keywords as high severity emergency intent', () => {
    const plan = createLocalHealthPlan('胸痛、呼吸困难，喘不上气')
    expect(plan.intent).toBe('emergency')
    expect(plan.severity).toBe('high')
  })

  it('adds Feishu suggestion when leave context is mentioned', () => {
    const plan = createLocalHealthPlan('我感冒了今天去不了公司')
    expect(plan.intent).toBe('leave_request')
    expect(plan.suggestedTools).toContain('send_feishu_message')
    expect(plan.leaveMessageText).toBeTruthy()
  })

  it('never produces unsupported tool names', () => {
    const plan = createLocalHealthPlan('我有点感冒')
    const allowed = new Set([
      'create_todo_list',
      'send_feishu_message',
      'notify_emergency_contact',
      'search_nearby_clinic',
      'route_to_clinic',
    ])
    plan.suggestedTools.forEach((tool) => {
      expect(allowed.has(tool)).toBe(true)
    })
  })
})
