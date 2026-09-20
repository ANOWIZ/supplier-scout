import { describe, expect, it } from 'vitest'
import { rankSuppliers, scoreSupplier } from './scoring'
import type { Supplier } from './types'

const base: Supplier = {
  id: 'sample', name: 'Sample', location: 'Екатеринбург', products: ['Кофе в зернах'], description: '',
  minimum_order: { kg: null, rub: null, label: 'не указано' },
  price: { amount: null, currency: 'RUB', unit: 'кг', label: 'по запросу' },
  delivery: '', delivers_to_ekaterinburg: true, certificates: '', contacts: { phone: null, email: null },
  website: 'https://example.com', verified_at: '2026-09-20',
  sources: [{ title: 'Official', url: 'https://example.com', type: 'official' }], evidence: [],
}

describe('supplier scoring', () => {
  it('gives partial—not full—MOQ points when minimum is unknown', () => {
    expect(scoreSupplier(base, 10, new Date('2026-09-20T12:00:00Z')).breakdown.minimum_fit).toBe(8)
  })

  it('ranks deterministically by score, then name', () => {
    const ranked = rankSuppliers([{ ...base, id: 'b', name: 'Бета' }, { ...base, id: 'a', name: 'Альфа' }], 10)
    expect(ranked.map((item) => item.name)).toEqual(['Альфа', 'Бета'])
  })

  it('does not award reliability points without sources', () => {
    const score = scoreSupplier({ ...base, sources: [] }, 10, new Date('2026-09-20T12:00:00Z'))
    expect(score.breakdown.source_reliability).toBe(0)
  })

  it('reduces freshness points as the snapshot ages', () => {
    const score = scoreSupplier(base, 10, new Date('2027-04-01T12:00:00Z'))
    expect(score.breakdown.freshness).toBe(0)
  })
})
