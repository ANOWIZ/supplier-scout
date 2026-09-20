import type { Score, Supplier } from './types'

export const SCORE_VERSION = 'coffee-horeca-v2'

function sourceReliability(supplier: Supplier): number {
  if (supplier.sources.length === 0) return 0
  try {
    const websiteHost = new URL(supplier.website).hostname.replace(/^www\./, '')
    const allOfficial = supplier.sources.every((source) => {
      const sourceHost = new URL(source.url).hostname.replace(/^www\./, '')
      return source.type === 'official' && (sourceHost === websiteHost || sourceHost.endsWith(`.${websiteHost}`))
    })
    return allOfficial ? 15 : 8
  } catch {
    return 0
  }
}

function freshnessPoints(verifiedAt: string, now = new Date()): number {
  const verified = new Date(`${verifiedAt}T00:00:00Z`)
  if (Number.isNaN(verified.getTime())) return 0
  const ageDays = Math.max(0, (now.getTime() - verified.getTime()) / 86_400_000)
  if (ageDays <= 30) return 10
  if (ageDays <= 90) return 6
  if (ageDays <= 180) return 3
  return 0
}

export function scoreSupplier(supplier: Supplier, requestedKg: number, now = new Date()): Score {
  const minimumKg = supplier.minimum_order.kg
  const breakdown = {
    product_match: supplier.products.includes('Кофе в зернах') ? 30 : 0,
    delivery_region: supplier.delivers_to_ekaterinburg === true ? 25 : 0,
    minimum_fit: minimumKg === null ? 8 : minimumKg <= requestedKg ? 15 : 0,
    source_reliability: sourceReliability(supplier),
    freshness: freshnessPoints(supplier.verified_at, now),
    price_transparency: supplier.price.amount !== null ? 5 : 0,
  }

  return {
    total: Object.values(breakdown).reduce((total, value) => total + value, 0),
    version: SCORE_VERSION,
    breakdown,
  }
}

export function rankSuppliers(suppliers: Supplier[], requestedKg: number): Supplier[] {
  return suppliers
    .map((supplier) => ({ ...supplier, score: scoreSupplier(supplier, requestedKg) }))
    .sort((left, right) => (right.score?.total ?? 0) - (left.score?.total ?? 0) || left.name.localeCompare(right.name, 'ru'))
}
