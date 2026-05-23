import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { env } from '../config/env.js'
import { AppError } from '../lib/httpError.js'

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'
const TOKEN_REFRESH_SKEW_MS = 60_000

type TenantTokenCache = {
  cacheKey: string
  token: string
  expiresAt: number
}

export type FeishuAppConfig = {
  appId?: string
  appSecret?: string
}

export type FeishuTarget = {
  openId?: string
  userId?: string
  mobile?: string
  email?: string
  name?: string
}

export type FeishuUser = {
  name: string
  openId: string
  userId?: string
  mobile?: string
  email?: string
}

type FeishuSearchItem = {
  name?: string
  en_name?: string
  user_id?: string
  open_id?: string
  union_id?: string
  mobile?: string
  email?: string
}

type FeishuResponse<T> = {
  code: number
  msg?: string
  data?: T
}

let tenantTokenCache: TenantTokenCache | null = null

const feishuClient: AxiosInstance = axios.create({
  baseURL: FEISHU_API_BASE,
  timeout: 12_000,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
  },
})

function isRetryable(error: AxiosError) {
  const status = error.response?.status
  return !status || status === 429 || status >= 500
}

async function requestWithRetry<T>(config: AxiosRequestConfig, retries = 2): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await feishuClient.request<T>(config)
      return response.data
    } catch (error) {
      lastError = error
      if (!axios.isAxiosError(error) || !isRetryable(error) || attempt === retries) break
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt))
    }
  }

  throw normalizeFeishuError(lastError)
}

function assertFeishuSuccess<T>(response: FeishuResponse<T>, action: string): T {
  if (response.code !== 0) {
    throw new AppError(502, 'FEISHU_API_ERROR', `${action}失败：${response.msg || response.code}`)
  }

  return response.data as T
}

function normalizeFeishuError(error: unknown) {
  if (error instanceof AppError) return error

  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 502
    const feishuMessage = (error.response?.data as { msg?: string } | undefined)?.msg
    return new AppError(status, 'FEISHU_REQUEST_FAILED', feishuMessage || '飞书服务请求失败')
  }

  return new AppError(502, 'FEISHU_REQUEST_FAILED', '飞书服务请求失败')
}

function resolveAppConfig(config?: FeishuAppConfig) {
  const hasOverride = Boolean(config?.appId || config?.appSecret)
  const appId = hasOverride ? config?.appId : env.FEISHU_APP_ID
  const appSecret = hasOverride ? config?.appSecret : env.FEISHU_APP_SECRET

  if (!appId || !appSecret) {
    throw new AppError(400, 'FEISHU_APP_NOT_CONFIGURED', '请先绑定飞书 app_id 和 app_secret')
  }

  return { appId, appSecret }
}

export async function getTenantAccessToken(config?: FeishuAppConfig): Promise<string> {
  const { appId, appSecret } = resolveAppConfig(config)
  const cacheKey = appId

  if (
    tenantTokenCache?.cacheKey === cacheKey &&
    tenantTokenCache.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS
  ) {
    return tenantTokenCache.token
  }

  const response = await requestWithRetry<{
    code: number
    msg?: string
    tenant_access_token?: string
    expire?: number
  }>({
    method: 'POST',
    url: '/auth/v3/tenant_access_token/internal',
    data: {
      app_id: appId,
      app_secret: appSecret,
    },
  })

  if (response.code !== 0 || !response.tenant_access_token || !response.expire) {
    throw new AppError(
      502,
      'FEISHU_TOKEN_ERROR',
      `获取飞书 tenant_access_token 失败：${response.msg || response.code}`,
    )
  }

  tenantTokenCache = {
    cacheKey,
    token: response.tenant_access_token,
    expiresAt: Date.now() + response.expire * 1000,
  }

  return tenantTokenCache.token
}

async function authorizedRequest<T>(config: AxiosRequestConfig, appConfig?: FeishuAppConfig): Promise<T> {
  const token = await getTenantAccessToken(appConfig)
  return requestWithRetry<T>({
    ...config,
    headers: {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

function cleanTarget(target: FeishuTarget): FeishuTarget {
  return {
    name: target.name?.trim() || undefined,
    openId: target.openId?.trim() || undefined,
    userId: target.userId?.trim() || undefined,
    mobile: target.mobile?.trim() || undefined,
    email: target.email?.trim() || undefined,
  }
}

function candidateSearchItems(data: {
  items?: FeishuSearchItem[]
  users?: FeishuSearchItem[]
  user_list?: FeishuSearchItem[]
}) {
  return data.items || data.users || data.user_list || []
}

function normalizeContactName(value: string | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function pickUserByName(users: FeishuSearchItem[], keyword: string) {
  const normalizedKeyword = normalizeContactName(keyword)
  const exact = users.find((user) =>
    normalizeContactName(user.name) === normalizedKeyword || normalizeContactName(user.en_name) === normalizedKeyword,
  )
  const fuzzy = users.find((user) => {
    const name = normalizeContactName(user.name)
    const enName = normalizeContactName(user.en_name)
    return Boolean(
      (name && (name.includes(normalizedKeyword) || normalizedKeyword.includes(name))) ||
        (enName && (enName.includes(normalizedKeyword) || normalizedKeyword.includes(enName))),
    )
  })
  return exact || fuzzy || users[0]
}

async function listUserByName(keyword: string, appConfig?: FeishuAppConfig): Promise<FeishuUser> {
  const users: FeishuSearchItem[] = []
  let pageToken: string | undefined

  for (let page = 0; page < 10; page += 1) {
    const response = await authorizedRequest<
      FeishuResponse<{
        has_more?: boolean
        page_token?: string
        items?: FeishuSearchItem[]
      }>
    >(
      {
        method: 'GET',
        url: '/contact/v3/users',
        params: {
          user_id_type: 'open_id',
          page_size: 50,
          page_token: pageToken,
        },
      },
      appConfig,
    )

    const data = assertFeishuSuccess(response, '读取飞书通讯录')
    users.push(...(data.items || []))
    const selected = pickUserByName(users, keyword)
    const direct = selected ? itemToUser(selected, keyword) : null
    if (direct && normalizeContactName(direct.name).includes(normalizeContactName(keyword))) return direct
    if (!data.has_more || !data.page_token) break
    pageToken = data.page_token
  }

  const selected = pickUserByName(users, keyword)
  const direct = selected ? itemToUser(selected, keyword) : null
  if (direct) return direct

  throw new AppError(404, 'FEISHU_CONTACT_NAME_NOT_FOUND', '没有在飞书通讯录中找到「' + keyword + '」')
}
function itemToUser(item: FeishuSearchItem, fallbackName: string): FeishuUser | null {
  const openId = item.open_id || (item.user_id?.startsWith('ou_') ? item.user_id : undefined)
  if (!openId) return null
  return {
    name: item.name || item.en_name || fallbackName,
    openId,
    userId: item.user_id,
    mobile: item.mobile,
    email: item.email,
  }
}

export async function getOpenIdByBatchGetId(
  target: FeishuTarget,
  appConfig?: FeishuAppConfig,
): Promise<FeishuUser> {
  const normalized = cleanTarget(target)
  if (normalized.openId) {
    return {
      name: normalized.name || normalized.openId,
      openId: normalized.openId,
      userId: normalized.userId,
      mobile: normalized.mobile,
      email: normalized.email,
    }
  }

  if (!normalized.mobile && !normalized.userId && !normalized.email) {
    throw new AppError(400, 'FEISHU_TARGET_MISSING_ID', '请提供目标联系人的手机号、飞书 user_id、邮箱或 open_id')
  }

  const response = await authorizedRequest<
    FeishuResponse<{
      user_list?: Array<{
        user_id?: string
        open_id?: string
        union_id?: string
        mobile?: string
        email?: string
      }>
    }>
  >(
    {
      method: 'POST',
      url: '/contact/v3/users/batch_get_id',
      params: {
        user_id_type: 'open_id',
      },
      data: {
        mobiles: normalized.mobile ? [normalized.mobile] : undefined,
        emails: normalized.email ? [normalized.email] : undefined,
        user_ids: normalized.userId ? [normalized.userId] : undefined,
      },
    },
    appConfig,
  )

  const data = assertFeishuSuccess(response, '获取飞书联系人 open_id')
  const user = data.user_list?.find((item) => item.open_id || item.user_id?.startsWith('ou_'))
  const openId = user?.open_id || (user?.user_id?.startsWith('ou_') ? user.user_id : undefined)

  if (!openId) {
    throw new AppError(404, 'FEISHU_TARGET_NOT_FOUND', '没有通过手机号/user_id/邮箱找到飞书联系人 open_id')
  }

  return {
    name: normalized.name || normalized.mobile || normalized.userId || normalized.email || openId,
    openId,
    userId: user?.user_id,
    mobile: user?.mobile || normalized.mobile,
    email: user?.email || normalized.email,
  }
}

export async function searchUserByName(name: string, appConfig?: FeishuAppConfig): Promise<FeishuUser> {
  const keyword = name.trim()
  if (!keyword) {
    throw new AppError(400, 'EMPTY_FEISHU_CONTACT_NAME', '飞书联系人姓名不能为空')
  }

  try {
    const response = await authorizedRequest<
      FeishuResponse<{
        items?: FeishuSearchItem[]
        users?: FeishuSearchItem[]
        user_list?: FeishuSearchItem[]
      }>
    >(
      {
        method: 'POST',
        url: '/contact/v3/users/search',
        params: {
          user_id_type: 'open_id',
        },
        data: {
          query: keyword,
          page_size: 10,
        },
      },
      appConfig,
    )

    const data = assertFeishuSuccess(response, '按姓名搜索飞书联系人')
    const users = candidateSearchItems(data)
    const selected = pickUserByName(users, keyword)
    const direct = selected ? itemToUser(selected, keyword) : null
    if (direct) return direct

    if (selected?.mobile || selected?.email) {
      return getOpenIdByBatchGetId(
        {
          name: selected.name || selected.en_name || keyword,
          mobile: selected.mobile,
          email: selected.email,
        },
        appConfig,
      )
    }
  } catch (error) {
    console.warn('Feishu users/search unavailable, falling back to users list', {
      name: keyword,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return listUserByName(keyword, appConfig)
}
export async function resolveFeishuUser(target: FeishuTarget, appConfig?: FeishuAppConfig): Promise<FeishuUser> {
  const normalized = cleanTarget(target)

  if (normalized.name) {
    try {
      return await searchUserByName(normalized.name, appConfig)
    } catch (error) {
      if (!normalized.openId && !normalized.userId && !normalized.mobile && !normalized.email) throw error
      console.warn('Feishu name search failed, falling back to explicit ids', {
        name: normalized.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (normalized.openId || normalized.userId || normalized.mobile || normalized.email) {
    return getOpenIdByBatchGetId(normalized, appConfig)
  }

  throw new AppError(400, 'FEISHU_TARGET_MISSING', '请提供飞书联系人姓名、手机号、user_id、邮箱或 open_id')
}

export async function sendMessageToUser(target: FeishuTarget, content: string, appConfig?: FeishuAppConfig) {
  const user = await resolveFeishuUser(target, appConfig)
  const sent = await sendMessage(user.openId, content, appConfig)
  return {
    user,
    ...sent,
  }
}

export async function sendMessage(openId: string, content: string, appConfig?: FeishuAppConfig) {
  if (!openId) {
    throw new AppError(400, 'EMPTY_OPEN_ID', '飞书 open_id 不能为空')
  }

  const response = await authorizedRequest<
    FeishuResponse<{
      message_id: string
      create_time?: string
    }>
  >(
    {
      method: 'POST',
      url: '/im/v1/messages',
      params: {
        receive_id_type: 'open_id',
      },
      data: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    },
    appConfig,
  )

  const data = assertFeishuSuccess(response, '发送飞书文本消息')
  return {
    messageId: data.message_id,
    createTime: data.create_time,
  }
}
