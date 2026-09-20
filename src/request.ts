import { CATEGORY_LABELS } from './scoring'
import type { SearchCriteria } from './types'

export function createRequest(criteria: SearchCriteria): string {
  const period = criteria.period === 'order' ? 'на один заказ' : 'в месяц'
  return `Здравствуйте! Ищем поставщика для кафе. Категория: ${CATEGORY_LABELS[criteria.category]}. Город доставки: ${criteria.region}. Ориентировочный объём — ${criteria.requestedKg} кг ${period}. Просим прислать актуальный прайс, минимальный заказ (разовый и месячный, если есть), сроки и стоимость доставки, условия оплаты, образцы и документы на выбранную продукцию. Спасибо!`
}
