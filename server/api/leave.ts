import { Router } from 'express'
import { z } from 'zod'
import { analyzeHealth, generateLeaveMessage } from '../agents/healthAgent.js'
import { sendMessageToUser } from '../feishu/client.js'
import { AppError } from '../lib/httpError.js'

export const leaveRouter = Router()

const sendLeaveSchema = z.object({
  symptom: z.string().trim().min(2).max(800),
  leaderName: z.string().trim().min(1).max(40),
  leaderOpenId: z.string().trim().optional(),
  leaderUserId: z.string().trim().optional(),
  leaderMobile: z.string().trim().optional(),
  leaderEmail: z.string().trim().optional(),
  feishuAppId: z.string().trim().optional(),
  feishuAppSecret: z.string().trim().optional(),
})

leaveRouter.post('/send', async (req, res, next) => {
  try {
    const parsed = sendLeaveSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_REQUEST', '请填写有效的症状描述和领导姓名')
    }

    const {
      symptom,
      leaderName,
      leaderOpenId,
      leaderUserId,
      leaderMobile,
      leaderEmail,
      feishuAppId,
      feishuAppSecret,
    } = parsed.data
    const health = await analyzeHealth(symptom)
    const leaveMessage = await generateLeaveMessage({
      symptom,
      leaderName,
      severity: health.severity,
      recommendedActions: health.recommendedActions,
    })
    const sent = await sendMessageToUser(
      {
        name: leaderName,
        openId: leaderOpenId,
        userId: leaderUserId,
        mobile: leaderMobile,
        email: leaderEmail,
      },
      leaveMessage.message,
      {
        appId: feishuAppId,
        appSecret: feishuAppSecret,
      },
    )
    const leader = sent.user

    res.json({
      success: true,
      message: '已发送请假信息',
      data: {
        severity: health.severity,
        reason: health.reason,
        leader: {
          name: leader.name,
          openId: leader.openId,
        },
        leaveMessage: leaveMessage.message,
        feishu: sent,
        leaderReply: {
          status: 'pending',
          message: '飞书消息已发送，领导回复需通过飞书事件订阅或后续轮询获取',
        },
      },
    })
  } catch (error) {
    next(error)
  }
})
