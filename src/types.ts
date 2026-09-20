export type Confidence = 'high' | 'medium' | 'low'

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
  minimum_order: { kg: number | null; rub: number | null; label: string }
  price: { amount: number | null; currency: string; unit: string; label: string }
  delivery: string
  delivers_to_ekaterinburg: boolean | null
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
    category: string
    region: string
    verified_at: string
    method: string
    disclaimer: string
  }
  suppliers: Supplier[]
}
