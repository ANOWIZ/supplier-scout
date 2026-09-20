import { rankSuppliers } from './scoring'
import type { Supplier, SupplierSnapshot } from './types'

export type DataMode = 'api' | 'snapshot'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export async function loadSuppliers(requestedKg: number): Promise<{ suppliers: Supplier[]; meta: SupplierSnapshot['meta']; mode: DataMode }> {
  const snapshotResponse = await fetch(new URL('suppliers.json', document.baseURI))
  if (!snapshotResponse.ok) throw new Error('Не удалось загрузить локальный снимок данных')
  const snapshot = (await snapshotResponse.json()) as SupplierSnapshot

  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 1600)
    const response = await fetch(`${apiBaseUrl}/api/v1/suppliers?region=${encodeURIComponent(snapshot.meta.region)}&requested_kg=${requestedKg}`, {
      signal: controller.signal,
    })
    window.clearTimeout(timeout)
    if (!response.ok) throw new Error('API unavailable')
    const payload = (await response.json()) as { items: Supplier[] }
    return { suppliers: payload.items, meta: snapshot.meta, mode: 'api' }
  } catch {
    return { suppliers: rankSuppliers(snapshot.suppliers, requestedKg), meta: snapshot.meta, mode: 'snapshot' }
  }
}
