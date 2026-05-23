import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { env } from '../config/env.js'
import { AppError } from '../lib/httpError.js'

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'
const TOKEN_REFRESH_SKEW_MS = 60_000

type TenantTokenCache = {
  token: string
  expiresAt: number
}

let tenantTokenCache: TenantTokenCache | null = null

export type FeishuUser = {
  name: string
  openId: string
  userId?: string
}

type FeishuResponse<T> = {
  code: number
  msg?: string
  data?: T
}

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

export async function getTenantAccessToken(): Promise<string> {
  if (tenantTokenCache && tenantTokenCache.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) {
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
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
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
    token: response.tenant_access_token,
    expiresAt: Date.now() + response.expire * 1000,
  }

  return tenantTokenCache.token
}

async function authorizedRequest<T>(config: AxiosRequestConfig): Promise<T> {
  const token = await getTenantAccessToken()
  return requestWithRetry<T>({
    ...config,
    headers: {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function searchUserByName(name: string): Promise<FeishuUser> {
  const keyword = name.trim()
  if (!keyword) {
    throw new AppError(400, 'EMPTY_LEADER_NAME', '领导姓名不能为空')
  }

  const response = await authorizedRequest<
    FeishuResponse<{
      items?: Array<{
        name?: string
        en_name?: string
        user_id?: string
        open_id?: string
      }>
    }>
  >({
    method: 'POST',
    url: '/contact/v3/users/search',
    data: {
      query: keyword,
      page_size: 10,
    },
  })

  const data = assertFeishuSuccess(response, '搜索飞书联系人')
  const users = data.items || []
  const exact = users.find((user) => user.name === keyword)
  const fuzzy = users.find((user) => user.name?.includes(keyword) || keyword.includes(user.name || ''))
  const selected = exact || fuzzy || users[0]

  if (!selected?.open_id) {
    throw new AppError(404, 'LEADER_NOT_FOUND', `没有在飞书通讯录中找到「${keyword}」`)
  }

  return {
    name: selected.name || selected.en_name || keyword,
    openId: selected.open_id,
    userId: selected.user_id,
  }
}

export async function sendMessage(openId: string, content: string) {
  if (!openId) {
    throw new AppError(400, 'EMPTY_OPEN_ID', '飞书 open_id 不能为空')
  }

  const response = await authorizedRequest<
    FeishuResponse<{
      message_id: string
      create_time?: string
    }>
  >({
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
  })

  const data = assertFeishuSuccess(response, '发送飞书请假消息')
  return {
    messageId: data.message_id,
    createTime: data.create_time,
  }
}
