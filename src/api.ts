import type { SupplierSnapshot } from './types'

export type DataMode = 'api' | 'snapshot'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

const nullableString = (value: unknown) => value === null || typeof value === 'string'
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const webUrl = (value: unknown) => typeof value === 'string' && /^https?:\/\//.test(value)
const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))

function validateSnapshot(value: unknown): SupplierSnapshot {
  const snapshot = value as SupplierSnapshot
  if (!snapshot?.meta?.categories?.length || !snapshot.meta.regions?.length || !Array.isArray(snapshot.suppliers)) {
    throw new Error('Некорректный формат каталога')
  }
  if (!Array.isArray(snapshot.meta.categories) || !Array.isArray(snapshot.meta.regions)
    || !snapshot.meta.categories.every(item => item && ['coffee-beans', 'tea'].includes(item.id) && typeof item.name === 'string')
    || !snapshot.meta.regions.every(region => ['Екатеринбург', 'Москва'].includes(region))
    || !validDate(snapshot.meta.verified_at) || typeof snapshot.meta.disclaimer !== 'string') throw new Error('Некорректные сведения о каталоге')
  const ids = new Set<string>()
  for (const supplier of snapshot.suppliers) {
    if (!supplier || typeof supplier.id !== 'string' || ids.has(supplier.id) || !supplier.offers || !Object.keys(supplier.offers).length
      || !supplier.delivery_regions || !Array.isArray(supplier.sources) || !Array.isArray(supplier.evidence)
      || ![supplier.name, supplier.location, supplier.description, supplier.delivery, supplier.certificates].every(field => typeof field === 'string')
      || !stringArray(supplier.products) || !webUrl(supplier.website) || !validDate(supplier.verified_at)
      || !supplier.contacts || !nullableString(supplier.contacts.phone) || !nullableString(supplier.contacts.email)
      || !Object.values(supplier.delivery_regions).every(status => status === true || status === false || status === null)) {
      throw new Error('Не удалось прочитать данные поставщика')
    }
    ids.add(supplier.id)
    for (const [category, offer] of Object.entries(supplier.offers)) {
      if (!['coffee-beans', 'tea'].includes(category) || !offer?.minimum_order || !offer.price
        || !nullableNumber(offer.minimum_order.kg) || !nullableNumber(offer.minimum_order.rub) || !nullableNumber(offer.price.amount)
        || !['order', 'month', 'unknown'].includes(offer.minimum_order.period)
        || typeof offer.minimum_order.label !== 'string' || typeof offer.price.label !== 'string') throw new Error('Не удалось прочитать условия поставки')
    }
    if (!supplier.sources.every(source => source && webUrl(source.url) && typeof source.title === 'string' && ['official', 'registry', 'marketplace'].includes(source.type))
      || !supplier.evidence.every(item => item && stringArray(item.fields) && typeof item.quote === 'string'
        && ['high', 'medium', 'low'].includes(item.confidence) && Number.isInteger(item.source_index)
        && item.source_index >= 0 && item.source_index < supplier.sources.length)) throw new Error('Некорректные источники поставщика')
  }
  return snapshot
}

async function fetchSnapshot(url: string | URL, timeoutMs: number): Promise<SupplierSnapshot> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Каталог недоступен (${response.status})`)
    return validateSnapshot(await response.json())
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function loadSuppliers(options: { apiUrl?: string; snapshotUrl?: string | URL; useApi?: boolean } = {}): Promise<SupplierSnapshot & { mode: DataMode }> {
  // Load the complete catalog so changing filters cannot reuse a partial API response.
  if (options.useApi ?? (Boolean(apiBaseUrl) || import.meta.env.DEV)) {
    try {
      const snapshot = await fetchSnapshot(options.apiUrl ?? `${apiBaseUrl}/api/v1/catalog`, 1600)
      return { ...snapshot, mode: 'api' }
    } catch {
      // An independently deployable snapshot remains available when the API is down.
    }
  }
  const snapshot = await fetchSnapshot(options.snapshotUrl ?? new URL('suppliers.json', document.baseURI), 8000)
  return { ...snapshot, mode: 'snapshot' }
}
