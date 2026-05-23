import { Router } from 'express'
import { AppError } from '../lib/httpError.js'
import { readUserSettings, saveUserSettings, userSettingsSchema } from '../settings/store.js'
import { resolveFeishuUser } from '../feishu/client.js'

export const settingsRouter = Router()

settingsRouter.get('/', async (_req, res, next) => {
  try {
    const settings = await readUserSettings()
    res.json({ success: true, settings })
  } catch (error) {
    next(error)
  }
})

settingsRouter.put('/', async (req, res, next) => {
  try {
    const parsed = userSettingsSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_SETTINGS', '设置内容不正确')
    }

    const settings = await saveUserSettings(parsed.data)
    res.json({ success: true, settings })
  } catch (error) {
    next(error)
  }
})
settingsRouter.post('/test-feishu-contact', async (req, res, next) => {
  try {
    const settings = await readUserSettings()
    const contactName = (req.body?.name || settings.leaderName || '').trim()
    if (!contactName) {
      throw new AppError(400, 'FEISHU_CONTACT_NAME_REQUIRED', '请先在设置页填写飞书联系人姓名')
    }

    const user = await resolveFeishuUser(
      { name: contactName },
      { appId: settings.feishuAppId, appSecret: settings.feishuAppSecret },
    )

    res.json({
      success: true,
      contact: {
        name: user.name,
        openId: user.openId,
        userId: user.userId,
      },
    })
  } catch (error) {
    next(error)
  }
})
