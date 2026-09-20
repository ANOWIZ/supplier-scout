import type { Category, Offer, Score, SearchCriteria, Supplier } from './types'

export const SCORE_VERSION = 'horeca-v3'
export const DEFAULT_CRITERIA: SearchCriteria = { category: 'coffee-beans', region: 'Екатеринбург', requestedKg: 10, period: 'order' }
export const CATEGORY_LABELS: Record<Category, string> = { 'coffee-beans': 'Кофе в зернах', tea: 'Чай' }

const unknownOffer: Offer = {
  minimum_order: { kg: null, rub: null, period: 'unknown', label: 'Уточнить для выбранной категории' },
  price: { amount: null, currency: 'RUB', unit: 'кг', label: 'по запросу' },
}

export function offerFor(supplier: Supplier, category: Category): Offer {
  return supplier.offers[category] ?? unknownOffer
}

export function minimumStatus(supplier: Supplier, criteria: SearchCriteria): 'fits' | 'too-small' | 'rub' | 'period' | 'unknown' {
  const minimum = offerFor(supplier, criteria.category).minimum_order
  if (minimum.rub !== null) return 'rub'
  if (minimum.kg === null || minimum.period === 'unknown') return 'unknown'
  if (minimum.period !== criteria.period) return 'period'
  return minimum.kg <= criteria.requestedKg ? 'fits' : 'too-small'
}

export function minimumExplanation(supplier: Supplier, criteria: SearchCriteria): string {
  const labels = {
    fits: 'Объём соответствует опубликованному минимуму.',
    'too-small': 'Выбранный объём меньше минимального.',
    rub: 'Минимум задан в рублях — соответствие объёму в кг не подтверждено.',
    period: 'Период не совпадает: разовый заказ и месячную закупку нельзя сравнить напрямую.',
    unknown: 'Минимальный объём не подтверждён — уточните у поставщика.',
  }
  return labels[minimumStatus(supplier, criteria)]
}

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

export function scoreSupplier(supplier: Supplier, criteria: SearchCriteria = DEFAULT_CRITERIA, now = new Date()): Score {
  const offer = offerFor(supplier, criteria.category)
  const breakdown = {
    product_match: supplier.offers[criteria.category] ? 30 : 0,
    delivery_region: supplier.delivery_regions[criteria.region] === true ? 25 : 0,
    minimum_fit: minimumStatus(supplier, criteria) === 'fits' ? 15 : 0,
    source_reliability: sourceReliability(supplier),
    freshness: freshnessPoints(supplier.verified_at, now),
    price_transparency: offer.price.amount !== null ? 5 : 0,
  }

  return {
    total: Object.values(breakdown).reduce((total, value) => total + value, 0),
    version: SCORE_VERSION,
    breakdown,
  }
}

export function rankSuppliers(suppliers: Supplier[], criteria: SearchCriteria = DEFAULT_CRITERIA): Supplier[] {
  return suppliers
    .filter((supplier) => supplier.offers[criteria.category] && supplier.delivery_regions[criteria.region] !== false)
    .map((supplier) => ({ ...supplier, score: scoreSupplier(supplier, criteria) }))
    .sort((left, right) => (right.score?.total ?? 0) - (left.score?.total ?? 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}
