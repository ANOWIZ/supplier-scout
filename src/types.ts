export type Confidence = 'high' | 'medium' | 'low'
export type Category = 'coffee-beans' | 'tea'
export type Region = 'Екатеринбург' | 'Москва'
export type OrderPeriod = 'order' | 'month'

export interface SearchCriteria {
  category: Category
  region: Region
  requestedKg: number
  period: OrderPeriod
}

export interface Offer {
  minimum_order: { kg: number | null; rub: number | null; period: OrderPeriod | 'unknown'; label: string }
  price: { amount: number | null; currency: string; unit: string; label: string }
}

export interface Source {
  title: string
  url: string
  type: 'official' | 'registry' | 'marketplace'
}

export interface Evidence {
  fields: string[]
  quote: string
  confidence: Confidence
  source_index: number
}

export interface Score {
  total: number
  version: string
  breakdown: Record<string, number>
}

export interface Supplier {
  id: string
  name: string
  location: string
  products: string[]
  description: string
  offers: Partial<Record<Category, Offer>>
  delivery: string
  delivery_regions: Partial<Record<Region, boolean | null>>
  certificates: string
  contacts: { phone: string | null; email: string | null }
  website: string
  verified_at: string
  sources: Source[]
  evidence: Evidence[]
  score?: Score
}

export interface SupplierSnapshot {
  meta: {
    categories: { id: Category; name: string; unit: string }[]
    regions: Region[]
    verified_at: string
    method: string
    disclaimer: string
  }
  suppliers: Supplier[]
}
