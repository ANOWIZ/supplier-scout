import { afterEach, describe, expect, it, vi } from 'vitest'
import snapshot from '../data/suppliers.json'
import { loadSuppliers } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('catalog loading', () => {
  it('returns the full catalog from the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)))
    vi.stubGlobal('fetch', fetchMock)
    const result = await loadSuppliers({ useApi: true, apiUrl: 'https://example.com/api', snapshotUrl: 'https://example.com/snapshot' })
    expect(result.mode).toBe('api')
    expect(result.suppliers).toHaveLength(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['http', 'invalid-json', 'invalid-shape', 'network'])('falls back when API fails: %s', async (failure) => {
    const fetchMock = vi.fn()
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'))
    else fetchMock.mockResolvedValueOnce(new Response(failure === 'invalid-json' ? '{' : '{}', { status: failure === 'http' ? 500 : 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
    vi.stubGlobal('fetch', fetchMock)
    const result = await loadSuppliers({ useApi: true, apiUrl: 'https://example.com/api', snapshotUrl: 'https://example.com/snapshot' })
    expect(result.mode).toBe('snapshot')
    expect(result.suppliers).toHaveLength(10)
  })

  it.each(['http', 'invalid-json', 'invalid-shape'])('surfaces snapshot failure for retry: %s', async (failure) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(failure === 'invalid-json' ? '{' : '{}', { status: failure === 'http' ? 500 : 200 })))
    await expect(loadSuppliers({ useApi: false, snapshotUrl: 'https://example.com/snapshot' })).rejects.toThrow()
  })

  it('rejects incomplete supplier records before rendering', async () => {
    const invalid = structuredClone(snapshot)
    invalid.suppliers[0].evidence[0].source_index = 999
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid))))
    await expect(loadSuppliers({ useApi: false, snapshotUrl: 'https://example.com/snapshot' })).rejects.toThrow('источники')
  })
})
