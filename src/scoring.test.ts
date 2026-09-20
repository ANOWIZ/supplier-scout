import { describe, expect, it } from 'vitest'
import { DEFAULT_CRITERIA, minimumStatus, rankSuppliers, scoreSupplier } from './scoring'
import { createRequest } from './request'
import cases from '../data/scoring-cases.json'
import snapshot from '../data/suppliers.json'
import type { Category, OrderPeriod, Region, SearchCriteria, Supplier } from './types'

const base: Supplier = {
  id: 'sample', name: 'Sample', location: 'Екатеринбург', products: ['Кофе в зернах', 'Чай'], description: '',
  offers: {
    'coffee-beans': { minimum_order: { kg: 5, rub: null, period: 'order', label: 'от 5 кг за заказ' }, price: { amount: null, currency: 'RUB', unit: 'кг', label: 'по запросу' } },
    tea: { minimum_order: { kg: null, rub: null, period: 'unknown', label: 'по запросу' }, price: { amount: null, currency: 'RUB', unit: 'кг', label: 'по запросу' } },
  },
  delivery: '', delivery_regions: { Екатеринбург: true, Москва: null }, certificates: '', contacts: { phone: null, email: null },
  website: 'https://example.com', verified_at: '2026-09-21',
  sources: [{ title: 'Official', url: 'https://example.com', type: 'official' }], evidence: [],
}

describe('shared Python / TypeScript scoring cases', () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const supplier = structuredClone(base)
      supplier.offers['coffee-beans']!.minimum_order = { kg: testCase.kg, rub: testCase.rub, period: testCase.minPeriod as OrderPeriod | 'unknown', label: '' }
      const criteria: SearchCriteria = { category: testCase.category as Category, region: testCase.region as Region, requestedKg: testCase.requestedKg, period: testCase.period as OrderPeriod }
      const score = scoreSupplier(supplier, criteria, new Date('2026-09-21T12:00:00Z'))
      expect(score.breakdown).toEqual({ product_match: testCase.product, delivery_region: testCase.delivery, minimum_fit: testCase.minimum, source_reliability: 15, freshness: 10, price_transparency: 0 })
      expect(score.total).toBe(testCase.product + testCase.delivery + testCase.minimum + 25)
      expect(minimumStatus(supplier, criteria) === 'fits').toBe(testCase.minimum === 15)
    })
  }
})

describe('catalog and requests', () => {
  it('ranks deterministically by score, then id independently of name locale', () => {
    const ranked = rankSuppliers([{ ...base, id: 'b', name: 'Альфа' }, { ...base, id: 'a', name: 'Zebra' }])
    expect(ranked.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('does not award reliability points without sources', () => {
    expect(scoreSupplier({ ...base, sources: [] }).breakdown.source_reliability).toBe(0)
  })

  it('reduces freshness points as the snapshot ages', () => {
    expect(scoreSupplier(base, DEFAULT_CRITERIA, new Date('2027-04-01T12:00:00Z')).breakdown.freshness).toBe(0)
  })

  it('filters by category and keeps unknown regions separate from refusals', () => {
    const suppliers = snapshot.suppliers as Supplier[]
    expect(rankSuppliers(suppliers, { ...DEFAULT_CRITERIA, category: 'tea' })).toHaveLength(4)
    expect(rankSuppliers([{ ...base, delivery_regions: { Москва: false } }], { ...DEFAULT_CRITERIA, region: 'Москва' })).toHaveLength(0)
    expect(rankSuppliers([{ ...base, offers: { 'coffee-beans': base.offers['coffee-beans'] } }], { ...DEFAULT_CRITERIA, category: 'tea' })).toHaveLength(0)
  })

  it('has contacts and evidence for each real supplier, with no contradictory Frumentum MOQ', () => {
    const suppliers = snapshot.suppliers as Supplier[]
    for (const supplier of suppliers) {
      expect(supplier.contacts.phone || supplier.contacts.email).toBeTruthy()
      expect(supplier.sources.length).toBeGreaterThan(0)
      for (const evidence of supplier.evidence) expect(supplier.sources[evidence.source_index]).toBeDefined()
    }
    expect(minimumStatus(suppliers.find(item => item.id === 'frumentum')!, DEFAULT_CRITERIA)).toBe('unknown')
  })

  it('uses selected category, region, period in the RFQ without competitor names', () => {
    const text = createRequest({ category: 'tea', region: 'Москва', period: 'month', requestedKg: 20 })
    expect(text).toContain('Чай')
    expect(text).toContain('Москва')
    expect(text).toContain('20 кг в месяц')
    expect(text).not.toContain('Рассматриваем')
    for (const supplier of snapshot.suppliers) expect(text).not.toContain(supplier.name)
  })
})
