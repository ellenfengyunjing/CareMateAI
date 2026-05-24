import { describe, expect, it, vi, beforeEach } from 'vitest'
import axios from 'axios'

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios')
  return {
    default: {
      ...actual.default,
      get: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
    },
    isAxiosError: actual.default.isAxiosError,
  }
})

import { searchNearbyClinics, getRoute } from '../tencentMap.js'

const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> }

describe('tencentMap', () => {
  beforeEach(() => {
    mockedAxios.get.mockReset()
  })

  it('searchNearbyClinics geocodes address, calls place/v1/search, and maps results', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { status: 0, result: { location: { lat: 22.5, lng: 113.9 } } },
    })
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 0,
        data: [
          {
            title: '南山医院',
            address: '南山区',
            location: { lat: 22.5, lng: 113.9 },
            _distance: 800,
            category: '医疗',
          },
          {
            title: '某药店',
            location: { lat: 22.5, lng: 113.9 },
          },
        ],
      },
    })
    const result = await searchNearbyClinics({
      location: '深圳市南山区',
      severity: 'medium',
      keyOverride: 'overridden_key',
    })
    expect(result[0].name).toBe('南山医院')
    const callArgs = mockedAxios.get.mock.calls[1]
    expect(mockedAxios.get.mock.calls[0][0]).toContain('/geocoder/v1')
    expect(callArgs[0]).toContain('/place/v1/search')
    expect(callArgs[1].params.key).toBe('overridden_key')
    expect(callArgs[1].params.keyword).toBe('医院')
  })

  it('searchNearbyClinics throws when status non-zero', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 0, result: { location: { lat: 22.5, lng: 113.9 } } } })
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 311, message: 'KEY 错误' } })
    await expect(
      searchNearbyClinics({ location: '深圳', severity: 'low', keyOverride: 'k' }),
    ).rejects.toThrow(/KEY 错误/)
  })

  it('getRoute geocodes addresses, calls direction/v1/walking, and formats description', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 0, result: { location: { lat: 22.5, lng: 113.9 } } } })
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 0, result: { location: { lat: 22.6, lng: 113.95 } } } })
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 0,
        result: { routes: [{ distance: 1500, duration: 900 }] },
      },
    })
    const result = await getRoute({ from: '家', to: '社康', mode: 'walking', keyOverride: 'k' })
    expect(result.distanceMeters).toBe(1500)
    expect(result.fromLocation).toEqual({ lat: 22.5, lng: 113.9 })
    expect(result.toLocation).toEqual({ lat: 22.6, lng: 113.95 })
    expect(result.description).toMatch(/步行/)
    expect(result.description).toMatch(/1\.5/)
    const callArgs = mockedAxios.get.mock.calls[2]
    expect(mockedAxios.get.mock.calls[0][0]).toContain('/geocoder/v1')
    expect(callArgs[0]).toContain('/direction/v1/walking')
  })

  it('getRoute throws when no routes found', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 0, result: { location: { lat: 22.5, lng: 113.9 } } } })
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 0, result: { location: { lat: 22.6, lng: 113.95 } } } })
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 0, result: { routes: [] } } })
    await expect(
      getRoute({ from: 'a', to: 'b', mode: 'walking', keyOverride: 'k' }),
    ).rejects.toThrow(/未找到合适的路线/)
  })
})
