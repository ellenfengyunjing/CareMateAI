import axios, { AxiosError } from 'axios'
import { env } from '../config/env.js'
import { AppError } from '../lib/httpError.js'

const TENCENT_API_BASE = 'https://apis.map.qq.com/ws'

export type ClinicResult = {
  name: string
  address: string
  distanceMeters: number
  category: string
  location: { lat: number; lng: number }
  phone?: string
}

export type RouteResult = {
  mode: 'walking' | 'driving'
  distanceMeters: number
  durationSeconds: number
  description: string
}

function resolveKey(override?: string) {
  const key = override?.trim() || env.TENCENT_MAP_KEY
  if (!key) {
    throw new AppError(
      400,
      'TENCENT_MAP_KEY_MISSING',
      '腾讯位置服务 key 未配置，请在设置页或服务端 .env 填写 TENCENT_MAP_KEY',
    )
  }
  return key
}

function normalizeAxiosError(error: unknown, action: string): AppError {
  if (error instanceof AppError) return error
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError<{ message?: string; status?: number }>
    const message = ax.response?.data?.message || ax.message
    return new AppError(502, 'TENCENT_MAP_REQUEST_FAILED', `${action}失败：${message}`)
  }
  return new AppError(502, 'TENCENT_MAP_REQUEST_FAILED', `${action}失败`)
}

function pickKeywordBySeverity(severity: 'low' | 'medium' | 'high'): string {
  if (severity === 'high') return '医院 急诊'
  if (severity === 'medium') return '医院'
  return '社区健康服务中心'
}

function formatLocation(location: { lat: number; lng: number }) {
  return `${location.lat},${location.lng}`
}

function parseLocation(value: string) {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  return { lat: Number(match[1]), lng: Number(match[2]) }
}

async function geocodeAddress(address: string, key: string) {
  const existing = parseLocation(address)
  if (existing) return existing

  const response = await axios.get<TencentGeocoderResponse>(`${TENCENT_API_BASE}/geocoder/v1`, {
    timeout: 10_000,
    params: {
      address,
      key,
    },
  })

  if (response.data.status !== 0 || !response.data.result?.location) {
    throw new AppError(502, 'TENCENT_GEOCODER_ERROR', `地址解析失败：${response.data.message || response.data.status}`)
  }

  return response.data.result.location
}

type TencentPlaceResponse = {
  status: number
  message?: string
  data?: Array<{
    id?: string
    title?: string
    address?: string
    category?: string
    tel?: string
    location?: { lat: number; lng: number }
    _distance?: number
  }>
}

type TencentGeocoderResponse = {
  status: number
  message?: string
  result?: {
    location?: { lat: number; lng: number }
    address?: string
  }
}

type TencentDirectionResponse = {
  status: number
  message?: string
  result?: {
    routes?: Array<{
      distance?: number
      duration?: number
      mode?: string
      polyline?: number[]
    }>
  }
}

export async function searchNearbyClinics(params: {
  location: string
  severity: 'low' | 'medium' | 'high'
  keyOverride?: string
}): Promise<ClinicResult[]> {
  const key = resolveKey(params.keyOverride)
  const keyword = pickKeywordBySeverity(params.severity)

  try {
    const center = await geocodeAddress(params.location, key)
    const response = await axios.get<TencentPlaceResponse>(`${TENCENT_API_BASE}/place/v1/search`, {
      timeout: 10_000,
      params: {
        keyword,
        boundary: `nearby(${formatLocation(center)},5000)`,
        page_size: 10,
        page_index: 1,
        orderby: '_distance',
        key,
      },
    })

    if (response.data.status !== 0) {
      throw new AppError(
        502,
        'TENCENT_MAP_API_ERROR',
        `腾讯位置服务返回错误：${response.data.message || response.data.status}`,
      )
    }

    const items = response.data.data || []
    return items
      .filter((item) => item.title && item.location)
      .slice(0, 3)
      .map<ClinicResult>((item) => ({
        name: item.title!,
        address: item.address || '',
        distanceMeters: item._distance || 0,
        category: item.category || '医疗',
        location: item.location!,
        phone: item.tel,
      }))
  } catch (error) {
    throw normalizeAxiosError(error, '搜索附近医院')
  }
}

export async function getRoute(params: {
  from: string
  to: string
  mode: 'walking' | 'driving'
  keyOverride?: string
}): Promise<RouteResult> {
  const key = resolveKey(params.keyOverride)

  try {
    const from = await geocodeAddress(params.from, key)
    const to = await geocodeAddress(params.to, key)
    const response = await axios.get<TencentDirectionResponse>(
      `${TENCENT_API_BASE}/direction/v1/${params.mode}`,
      {
        timeout: 10_000,
        params: {
          from: formatLocation(from),
          to: formatLocation(to),
          key,
        },
      },
    )

    if (response.data.status !== 0) {
      throw new AppError(
        502,
        'TENCENT_MAP_API_ERROR',
        `路线规划失败：${response.data.message || response.data.status}`,
      )
    }

    const route = response.data.result?.routes?.[0]
    if (!route) {
      throw new AppError(404, 'TENCENT_MAP_NO_ROUTE', '未找到合适的路线')
    }

    const distance = route.distance || 0
    const duration = route.duration || 0
    const distanceText = distance >= 1000 ? `${(distance / 1000).toFixed(1)}公里` : `${distance}米`
    const durationText = duration >= 60 ? `约 ${Math.round(duration / 60)} 分钟` : `不到 1 分钟`

    return {
      mode: params.mode,
      distanceMeters: distance,
      durationSeconds: duration,
      description: `${params.mode === 'walking' ? '步行' : '驾车'} ${distanceText}，${durationText}`,
    }
  } catch (error) {
    throw normalizeAxiosError(error, '路线规划')
  }
}
