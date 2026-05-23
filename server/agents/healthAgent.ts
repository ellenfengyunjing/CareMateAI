import OpenAI from 'openai'
import { z } from 'zod'
import { zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod'
import { env } from '../config/env.js'
import { healthAnalysisPrompt, leaveMessagePrompt } from './prompts.js'

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY })

export const severitySchema = z.enum(['low', 'medium', 'high'])

export const healthAnalysisSchema = z.object({
  severity: severitySchema,
  reason: z.string(),
  recommendedActions: z.array(z.string()).min(1),
  redFlags: z.array(z.string()),
})

export const leaveMessageSchema = z.object({
  severity: severitySchema,
  leaderName: z.string(),
  message: z.string(),
  tone: z.string(),
})

export type HealthAnalysis = z.infer<typeof healthAnalysisSchema>
export type LeaveMessage = z.infer<typeof leaveMessageSchema>

export const agentFunctionTools = [
  zodResponsesFunction({
    name: 'analyze_health',
    description: 'Analyze user symptoms and return a severity level with next actions.',
    parameters: z.object({
      symptom: z.string(),
      duration: z.string().nullable(),
      temperature: z.string().nullable(),
      extraContext: z.string().nullable(),
    }),
  }),
  zodResponsesFunction({
    name: 'generate_leave_message',
    description: 'Generate a natural Chinese sick leave message for a workplace leader.',
    parameters: z.object({
      symptom: z.string(),
      severity: severitySchema,
      leaderName: z.string(),
    }),
  }),
]

export async function analyzeHealth(symptom: string): Promise<HealthAnalysis> {
  const response = await openai.responses.parse({
    model: env.OPENAI_MODEL,
    instructions: healthAnalysisPrompt,
    input: [
      {
        role: 'user',
        content: `用户身体不适描述：${symptom}`,
      },
    ],
    text: {
      format: zodTextFormat(healthAnalysisSchema, 'health_analysis'),
      verbosity: 'low',
    },
  })

  if (!response.output_parsed) {
    throw new Error('AI health analysis returned empty structured output')
  }

  return response.output_parsed
}

export async function generateLeaveMessage(params: {
  symptom: string
  leaderName: string
  severity: HealthAnalysis['severity']
  recommendedActions?: string[]
}): Promise<LeaveMessage> {
  const response = await openai.responses.parse({
    model: env.OPENAI_MODEL,
    instructions: leaveMessagePrompt,
    input: [
      {
        role: 'user',
        content: [
          `领导姓名：${params.leaderName}`,
          `症状：${params.symptom}`,
          `病情严重程度：${params.severity}`,
          `建议动作：${params.recommendedActions?.join('、') || '请假休息并视情况就医'}`,
        ].join('\n'),
      },
    ],
    text: {
      format: zodTextFormat(leaveMessageSchema, 'leave_message'),
      verbosity: 'low',
    },
  })

  if (!response.output_parsed) {
    throw new Error('AI leave message returned empty structured output')
  }

  return response.output_parsed
}
