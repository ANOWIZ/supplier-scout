import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSuppliers, type DataMode } from './api'
import { rankSuppliers } from './scoring'
import type { Supplier, SupplierSnapshot } from './types'

const scoreLabels: Record<string, string> = {
  product_match: 'Категория',
  delivery_region: 'Доставка',
  minimum_fit: 'Размер заказа',
  source_reliability: 'Надёжность источника',
  freshness: 'Свежесть данных',
  price_transparency: 'Открытая цена',
}

function ArrowIcon() {
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h11M10 4l5 5-5 5" /></svg>
}

const fieldLabels: Record<string, string> = {
  products: 'Ассортимент', minimum_order: 'Минимальный заказ', price: 'Цена',
  delivery: 'Доставка', delivers_to_ekaterinburg: 'Доставка в Екатеринбург',
  contacts: 'Контакты', location: 'Город', certificates: 'Документы',
}
const confidenceLabels = { high: 'Указано на сайте', medium: 'Требует уточнения', low: 'Не подтверждено' }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inertTargets = Array.from(document.querySelectorAll<HTMLElement>('.app-header, .app-shell > main, .selection-bar'))
    const previousOverflow = document.body.style.overflow
    inertTargets.forEach((element) => element.setAttribute('inert', ''))
    document.body.style.overflow = 'hidden'

    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    focusable[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      inertTargets.forEach((element) => element.removeAttribute('inert'))
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [onClose])

  return dialogRef
}

function downloadCsv(items: Supplier[]) {
  const protectSpreadsheetCell = (value: string) => /^[\t\r=+\-@]/.test(value) ? `'${value}` : value
  const rows = [
    ['Поставщик', 'Город', 'Минимальный заказ', 'Цена', 'Доставка в Екатеринбург', 'Контакт', 'Источник', 'Проверено'],
    ...items.map((item) => [
      item.name,
      item.location,
      item.minimum_order.label,
      item.price.label,
      item.delivers_to_ekaterinburg === true ? 'Да' : item.delivers_to_ekaterinburg === false ? 'Нет' : 'Уточнить',
      item.contacts.email ?? item.contacts.phone ?? 'на сайте',
      item.website,
      item.verified_at,
    ]),
  ]
  const csv = rows.map((row) => row.map((cell) => `"${protectSpreadsheetCell(String(cell)).replaceAll('"', '""')}"`).join(';')).join('\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  link.download = 'supplier-scout-shortlist.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

function createRequest(items: Supplier[], requestedKg: number) {
  const names = items.map((item) => item.name).join(', ')
  return `Здравствуйте! Ищем поставщика кофе в зернах для кафе в Екатеринбурге, ориентировочный объём — ${requestedKg} кг в месяц. Рассматриваем: ${names}. Просим прислать актуальный прайс, минимальный объём заказа, сроки и стоимость доставки, условия оплаты, образцы и комплект сертификатов. Спасибо!`
}

function ScoreDial({ value }: { value: number }) {
  return (
    <div className="score-dial" style={{ '--score': `${value * 3.6}deg` } as React.CSSProperties} aria-label={`Оценка ${value} из 100`}>
      <span>{value}</span>
    </div>
  )
}

function SupplierRow({
  supplier,
  selected,
  onToggle,
  onOpen,
}: {
  supplier: Supplier
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <article className={`supplier-row ${selected ? 'is-selected' : ''}`}>
      <button className="row-main" onClick={onOpen} aria-label={`Открыть данные ${supplier.name}`}>
        <span className="supplier-title">
          <span className="supplier-name">{supplier.name}</span>
          <span className="supplier-location">{supplier.location}</span>
        </span>
        <span className="data-cell"><small>Мин. заказ</small>{supplier.minimum_order.label}</span>
        <span className="data-cell"><small>Цена</small>{supplier.price.label}</span>
        <span className="data-cell delivery-cell">
          <small>Екатеринбург</small>
          <span className={`delivery-dot ${supplier.delivers_to_ekaterinburg === true ? 'yes' : 'unknown'}`} />
          {supplier.delivers_to_ekaterinburg === true ? 'доставляет' : 'нужно уточнить'}
        </span>
        <ScoreDial value={supplier.score?.total ?? 0} />
      </button>
      <button className={`compare-toggle ${selected ? 'active' : ''}`} onClick={onToggle} aria-pressed={selected}>
        <span>{selected ? '✓' : '+'}</span>{selected ? 'В сравнении' : 'Сравнить'}
      </button>
    </article>
  )
}

function EvidenceDrawer({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose)
  const sourceFor = (index: number) => supplier.sources[index]
  return (
    <div className="drawer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={dialogRef} className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-top">
          <div>
            <p className="eyebrow">Карточка поставщика</p>
            <h2 id="drawer-title">{supplier.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <p className="drawer-description">{supplier.description}</p>

        <div className="drawer-facts">
          <div><small>Минимальный заказ</small><strong>{supplier.minimum_order.label}</strong></div>
          <div><small>Цена</small><strong>{supplier.price.label}</strong></div>
          <div><small>Проверено</small><strong>{formatDate(supplier.verified_at)}</strong></div>
          <div><small>Документы</small><strong>{supplier.certificates}</strong></div>
        </div>

        <section className="drawer-section">
          <h3>Почему такой балл</h3>
          <div className="score-breakdown">
            {Object.entries(supplier.score?.breakdown ?? {}).map(([key, value]) => (
              <div key={key}>
                <span>{scoreLabels[key] ?? key}</span>
                <span className="score-line"><i style={{ width: `${(value / 30) * 100}%` }} /></span>
                <strong>+{value}</strong>
              </div>
            ))}
          </div>
          <p className="method-note">Оценка помогает отсортировать варианты, но не заменяет закупочную проверку.</p>
        </section>

        <section className="drawer-section">
          <h3>Что указано на сайте</h3>
          <div className="evidence-list">
            {supplier.evidence.map((item, index) => {
              const source = sourceFor(item.source_index)
              return (
                <div className="evidence-item" key={`${item.quote}-${index}`}>
                  <div className="evidence-meta"><span>{item.fields.map(field => fieldLabels[field] ?? field).join(' · ')}</span><span className={`confidence ${item.confidence}`}>{confidenceLabels[item.confidence]}</span></div>
                  <p>{item.quote}</p>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.title} <ArrowIcon /></a>
                </div>
              )
            })}
          </div>
        </section>

        <div className="drawer-actions">
          <a className="primary-button" href={supplier.website} target="_blank" rel="noreferrer">Открыть сайт <ArrowIcon /></a>
          {supplier.contacts.email && <a className="text-link" href={`mailto:${supplier.contacts.email}`}>{supplier.contacts.email}</a>}
          {supplier.contacts.phone && <a className="text-link" href={`tel:${supplier.contacts.phone.replace(/[^+\d]/g, '')}`}>{supplier.contacts.phone}</a>}
        </div>
      </aside>
    </div>
  )
}

function ComparePanel({ items, requestedKg, onClose, onRemove }: { items: Supplier[]; requestedKg: number; onClose: () => void; onRemove: (id: string) => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose)
  const [copied, setCopied] = useState(false)
  const copyRequest = async () => {
    await navigator.clipboard.writeText(createRequest(items, requestedKg))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="compare-layer" role="presentation">
      <section ref={dialogRef} className="compare-panel" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <div className="compare-heading">
          <div><p className="eyebrow">Короткий список</p><h2 id="compare-title">Сравнение {items.length} поставщиков</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="compare-grid" style={{ gridTemplateColumns: `140px repeat(${items.length}, minmax(240px, 1fr))` }}>
          <div className="compare-labels" aria-hidden="true">
            <span /><span>Оценка</span><span>Мин. заказ</span><span>Цена</span><span>Доставка</span><span>Контакт</span>
          </div>
          {items.map((item) => (
            <div className="compare-column" key={item.id}>
              <div className="compare-name"><h3>{item.name}</h3><button onClick={() => onRemove(item.id)} aria-label={`Убрать ${item.name}`}>×</button></div>
              <strong className="compare-score">{item.score?.total}<small>/100</small></strong>
              <span>{item.minimum_order.label}</span>
              <span>{item.price.label}</span>
              <span>{item.delivery}</span>
              <span>{item.contacts.email ?? item.contacts.phone ?? 'на сайте'}</span>
            </div>
          ))}
        </div>
        <div className="compare-actions">
          <button className="primary-button" onClick={copyRequest}>{copied ? 'Запрос скопирован' : 'Скопировать запрос поставщикам'}</button>
          <button className="secondary-button" onClick={() => downloadCsv(items)}>Экспорт CSV</button>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [meta, setMeta] = useState<SupplierSnapshot['meta'] | null>(null)
  const [mode, setMode] = useState<DataMode>('snapshot')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [requestedKg, setRequestedKg] = useState(10)
  const [deliveryOnly, setDeliveryOnly] = useState(false)
  const [priceOnly, setPriceOnly] = useState(false)
  const [minimumFitOnly, setMinimumFitOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detail, setDetail] = useState<Supplier | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    loadSuppliers(requestedKg)
      .then((result) => {
        if (!active) return
        setSuppliers(result.suppliers)
        setMeta(result.meta)
        setMode(result.mode)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [requestedKg])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    return rankSuppliers(suppliers, requestedKg).filter((supplier) => {
      const matchesQuery = !normalized || [supplier.name, supplier.location, supplier.description, ...supplier.products].join(' ').toLocaleLowerCase('ru').includes(normalized)
      const matchesDelivery = !deliveryOnly || supplier.delivers_to_ekaterinburg === true
      const matchesPrice = !priceOnly || supplier.price.amount !== null
      const minimumKg = supplier.minimum_order.kg
      const matchesMinimum = !minimumFitOnly || (minimumKg !== null && minimumKg <= requestedKg)
      return matchesQuery && matchesDelivery && matchesPrice && matchesMinimum
    })
  }, [suppliers, requestedKg, query, deliveryOnly, priceOnly, minimumFitOnly])

  const selected = useMemo(
    () => selectedIds.map((id) => suppliers.find((supplier) => supplier.id === id)).filter(Boolean) as Supplier[],
    [selectedIds, suppliers],
  )

  const toggleSupplier = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 3 ? [...current, id] : current)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top"><span>SS</span> Supplier Scout</a>
        <nav aria-label="Основная навигация"><a href="#suppliers">Каталог</a><a href="#method">О данных</a></nav>
        <span className={`data-status ${mode}`}><i />{meta ? `Проверено ${formatDate(meta.verified_at)}` : 'Загрузка каталога'}</span>
      </header>

      <main id="top">
        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow">Кофе для кафе и ресторанов · Екатеринбург</p>
            <h1>Поставщики кофе</h1>
            <p>Сравните минимальный заказ, цены и доставку. В карточке каждой компании — контакты и ссылки на условия.</p>
          </div>
        </section>

        <section className="workspace" id="suppliers">
          <div className="search-panel">
            <label className="field category-field"><span>Что ищем</span><input value="Кофе в зернах" readOnly /></label>
            <label className="field region-field"><span>Куда</span><input value="Екатеринбург" readOnly /></label>
            <label className="field volume-field"><span>Объём в месяц</span><span className="number-input"><input type="number" min="1" max="100000" value={requestedKg} onChange={(event) => setRequestedKg(Math.max(1, Number(event.target.value) || 1))} /><b>кг</b></span></label>
            <button className="search-button" onClick={() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' })}>Показать варианты <ArrowIcon /></button>
          </div>

          <div className="results-heading" id="results">
            <div><h2>{loading ? 'Загружаем каталог…' : `${filtered.length} поставщиков`}</h2><p className="results-hint">Выберите 2–3 компании для сравнения.</p></div>
            <label className="inline-search"><span className="sr-only">Поиск по результатам</span><input placeholder="Название, город, услуга" value={query} onChange={(event) => setQuery(event.target.value)} /><span>⌕</span></label>
          </div>

          <div className="filter-row" aria-label="Фильтры">
            <button className={deliveryOnly ? 'active' : ''} onClick={() => setDeliveryOnly((value) => !value)}>Доставка в город</button>
            <button className={minimumFitOnly ? 'active' : ''} onClick={() => setMinimumFitOnly((value) => !value)}>Мин. заказ до {requestedKg} кг</button>
            <button className={priceOnly ? 'active' : ''} onClick={() => setPriceOnly((value) => !value)}>Цена опубликована</button>
            <span>Сначала с высокой оценкой</span>
          </div>

          <div className="supplier-head" aria-hidden="true"><span>Поставщик</span><span>Мин. заказ</span><span>Цена</span><span>Доставка</span><span>Оценка</span><span /></div>
          <div className={`supplier-list ${loading ? 'is-loading' : ''}`}>
            {filtered.map((supplier) => (
              <SupplierRow key={supplier.id} supplier={supplier} selected={selectedIds.includes(supplier.id)} onToggle={() => toggleSupplier(supplier.id)} onOpen={() => setDetail(supplier)} />
            ))}
            {!loading && filtered.length === 0 && <div className="empty-state"><h3>Под фильтры ничего не попало</h3><p>Снимите часть условий или измените запрос.</p></div>}
          </div>
        </section>

        <section className="method" id="method">
          <div className="method-intro"><h2>Откуда данные и как считается оценка</h2></div>
          <div className="method-steps">
            <div><h3>Источники</h3><p>Условия собраны вручную с сайтов поставщиков. Ссылки и выдержки доступны в карточках компаний.</p></div>
            <div><h3>Что нужно уточнить</h3><p>Если на сайте нет цены, размера заказа или документов, в каталоге указано «по запросу» или «не указано».</p></div>
            <div><h3>Оценка до 100 баллов</h3><p>Учитывает ассортимент, доставку, размер заказа, источники, дату проверки и наличие цены. Расчёт — в карточке; это не оценка качества кофе.</p></div>
          </div>
          <div className="method-foot">
            <span>Данные проверены {meta ? formatDate(meta.verified_at) : '—'}</span>
            <span>{meta?.disclaimer}</span>
          </div>
        </section>
      </main>

      {selected.length > 0 && !compareOpen && (
        <div className="selection-bar">
          <span><b>{selected.length}</b> из 3 выбрано</span>
          <span className="selected-names">{selected.map((item) => item.name).join(' · ')}</span>
          <button onClick={() => setCompareOpen(true)} disabled={selected.length < 2}>Сравнить {selected.length > 1 ? selected.length : ''} <ArrowIcon /></button>
        </div>
      )}

      {detail && <EvidenceDrawer supplier={detail} onClose={() => setDetail(null)} />}
      {compareOpen && <ComparePanel
        items={rankSuppliers(selected, requestedKg)}
        requestedKg={requestedKg}
        onClose={() => setCompareOpen(false)}
        onRemove={(id) => {
          const remaining = selectedIds.filter((item) => item !== id)
          setSelectedIds(remaining)
          if (remaining.length < 2) setCompareOpen(false)
        }}
      />}
    </div>
  )
}
