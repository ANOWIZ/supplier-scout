import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSuppliers, type DataMode } from './api'
import { CATEGORY_LABELS, DEFAULT_CRITERIA, minimumExplanation, minimumStatus, offerFor, rankSuppliers } from './scoring'
import { createRequest } from './request'
import type { Category, OrderPeriod, Region, SearchCriteria, Supplier, SupplierSnapshot } from './types'

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
  delivery: 'Доставка', delivery_regions: 'География доставки',
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
      const currentFocusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      if (event.key !== 'Tab' || currentFocusable.length === 0) return
      const first = currentFocusable[0]
      const last = currentFocusable[currentFocusable.length - 1]
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

function downloadCsv(items: Supplier[], criteria: SearchCriteria) {
  const protectSpreadsheetCell = (value: string) => /^[\t\r=+\-@]/.test(value) ? `'${value}` : value
  const rows = [
    ['Поставщик', 'Город компании', 'Категория', 'Город доставки', 'Объём, кг', 'Период', 'Минимальный заказ', 'Соответствие объёму', 'Цена', 'Доставка подтверждена', 'Контакт', 'Источник', 'Проверено'],
    ...items.map((item) => [
      item.name,
      item.location,
      CATEGORY_LABELS[criteria.category],
      criteria.region,
      criteria.requestedKg,
      criteria.period === 'order' ? 'за заказ' : 'в месяц',
      offerFor(item, criteria.category).minimum_order.label,
      minimumExplanation(item, criteria),
      offerFor(item, criteria.category).price.label,
      item.delivery_regions[criteria.region] === true ? 'Да' : item.delivery_regions[criteria.region] === false ? 'Нет' : 'Уточнить',
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

function ScoreDial({ value }: { value: number }) {
  return (
    <div className="score-dial" style={{ '--score': `${value * 3.6}deg` } as React.CSSProperties} aria-label={`Оценка ${value} из 100`}>
      <span>{value}</span>
    </div>
  )
}

function SupplierRow({
  supplier,
  criteria,
  selected,
  selectionFull,
  onToggle,
  onOpen,
}: {
  supplier: Supplier
  criteria: SearchCriteria
  selected: boolean
  selectionFull: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const offer = offerFor(supplier, criteria.category)
  const deliveryConfirmed = supplier.delivery_regions[criteria.region] === true
  return (
    <article className={`supplier-row ${selected ? 'is-selected' : ''}`}>
      <button className="row-main" onClick={onOpen} aria-label={`Открыть данные ${supplier.name}`}>
        <span className="supplier-title">
          <span className="supplier-name">{supplier.name}</span>
          <span className="supplier-location">{supplier.location}</span>
        </span>
        <span className="data-cell"><small>Мин. заказ</small>{offer.minimum_order.label}</span>
        <span className="data-cell"><small>Цена</small>{offer.price.label}</span>
        <span className="data-cell delivery-cell">
          <small>{criteria.region}</small>
          <span className={`delivery-dot ${deliveryConfirmed ? 'yes' : 'unknown'}`} />
          {deliveryConfirmed ? 'доставляет' : 'нужно уточнить'}
        </span>
        <ScoreDial value={supplier.score?.total ?? 0} />
      </button>
      <button className={`compare-toggle ${selected ? 'active' : ''}`} onClick={onToggle} aria-pressed={selected} disabled={!selected && selectionFull} title={!selected && selectionFull ? 'Можно сравнить до трёх компаний' : undefined}>
        <span aria-hidden="true">{selected ? '✓' : '+'}</span>{selected ? 'В сравнении' : 'Сравнить'}
      </button>
    </article>
  )
}

function EvidenceDrawer({ supplier, criteria, onClose }: { supplier: Supplier; criteria: SearchCriteria; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose)
  const offer = offerFor(supplier, criteria.category)
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
        <p className="context-note">{CATEGORY_LABELS[criteria.category]} · {criteria.region} · {criteria.requestedKg} кг {criteria.period === 'order' ? 'за заказ' : 'в месяц'}</p>

        <div className="drawer-facts">
          <div><small>Минимальный заказ</small><strong>{offer.minimum_order.label}</strong></div>
          <div><small>Цена</small><strong>{offer.price.label}</strong></div>
          <div><small>Проверено</small><strong>{formatDate(supplier.verified_at)}</strong></div>
          <div><small>Документы</small><strong>{supplier.certificates}</strong></div>
        </div>
        <p className="method-note">{minimumExplanation(supplier, criteria)}</p>
        <p className="method-note">Доставка — {criteria.region}: {supplier.delivery_regions[criteria.region] === true ? 'заявлена поставщиком' : 'требует уточнения'}. {supplier.delivery}</p>

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
          <p className="method-note">За неизвестный минимум, сумму в рублях или несовпадающий период баллы соответствия объёму не начисляются. Оценка не заменяет закупочную проверку.</p>
        </section>

        <section className="drawer-section">
          <h3>Источники и условия компании</h3>
          <p className="method-note">Ниже есть сведения о разных категориях. Для выбранной категории действуют условия в блоке выше.</p>
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

function ComparePanel({ items, criteria, onClose, onRemove }: { items: Supplier[]; criteria: SearchCriteria; onClose: () => void; onRemove: (id: string) => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(createRequest(criteria))
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
      setCopied(false)
    }
  }

  return (
    <div className="compare-layer" role="presentation">
      <section ref={dialogRef} className="compare-panel" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <div className="compare-heading">
          <div><p className="eyebrow">Короткий список</p><h2 id="compare-title">Сравнение {items.length} поставщиков</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <p className="context-note">{CATEGORY_LABELS[criteria.category]} · {criteria.region} · {criteria.requestedKg} кг {criteria.period === 'order' ? 'за заказ' : 'в месяц'}. Цены «от» — ориентиры, не предложения на одинаковый товар.</p>
        <div className="compare-grid" style={{ gridTemplateColumns: `140px repeat(${items.length}, minmax(240px, 1fr))` }}>
          <div className="compare-labels" aria-hidden="true">
            <span /><span>Оценка</span><span>Мин. заказ</span><span>Цена</span><span>Доставка</span><span>Контакт</span>
          </div>
          {items.map((item) => (
            <div className="compare-column" key={item.id}>
              <div className="compare-name"><h3>{item.name}</h3><button onClick={() => onRemove(item.id)} aria-label={`Убрать ${item.name}`}>×</button></div>
              <strong className="compare-score">{item.score?.total}<small>/100</small></strong>
              <span>{offerFor(item, criteria.category).minimum_order.label}<small className="minimum-note">{minimumExplanation(item, criteria)}</small></span>
              <span>{offerFor(item, criteria.category).price.label}</span>
              <span>{criteria.region}: {item.delivery_regions[criteria.region] === true ? 'доставка заявлена' : 'уточнить доставку'}. {item.delivery}</span>
              <span>{item.contacts.email ?? item.contacts.phone ?? 'на сайте'}<a className="supplier-source" href={item.website} target="_blank" rel="noreferrer">Сайт поставщика</a></span>
            </div>
          ))}
        </div>
        <div className="compare-actions">
          <button className="primary-button" onClick={copyRequest}>{copied ? 'Запрос скопирован' : 'Скопировать запрос поставщику'}</button>
          <button className="secondary-button" onClick={() => downloadCsv(items, criteria)}>Экспорт CSV</button>
        </div>
        <p className="sr-only" role="status">{copied ? 'Запрос скопирован в буфер обмена' : ''}</p>
        {copyError && <div className="request-fallback"><p role="alert">Не удалось скопировать автоматически. Выделите текст и скопируйте вручную.</p><textarea aria-label="Текст запроса поставщику" readOnly value={createRequest(criteria)} onFocus={(event) => event.target.select()} /></div>}
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
  const [criteria, setCriteria] = useState<SearchCriteria>(DEFAULT_CRITERIA)
  const { requestedKg } = criteria
  const [deliveryOnly, setDeliveryOnly] = useState(false)
  const [priceOnly, setPriceOnly] = useState(false)
  const [minimumFitOnly, setMinimumFitOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)

  const changeCriteria = (patch: Partial<SearchCriteria>) => {
    setCriteria((current) => ({ ...current, ...patch }))
    if (patch.category || patch.region) {
      setSelectedIds([])
      setDetailId(null)
      setCompareOpen(false)
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)
    loadSuppliers()
      .then((result) => {
        if (!active) return
        setSuppliers(result.suppliers)
        setMeta(result.meta)
        setMode(result.mode)
      })
      .catch(() => {
        if (!active) return
        setSuppliers([])
        setMeta(null)
        setLoadError(true)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [retry])

  const ranked = useMemo(() => rankSuppliers(suppliers, criteria), [suppliers, criteria])
  const detail = ranked.find((supplier) => supplier.id === detailId)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    return ranked.filter((supplier) => {
      const matchesQuery = !normalized || [supplier.name, supplier.location, supplier.description, ...supplier.products].join(' ').toLocaleLowerCase('ru').includes(normalized)
      const matchesDelivery = !deliveryOnly || supplier.delivery_regions[criteria.region] === true
      const matchesPrice = !priceOnly || offerFor(supplier, criteria.category).price.amount !== null
      const matchesMinimum = !minimumFitOnly || minimumStatus(supplier, criteria) === 'fits'
      return matchesQuery && matchesDelivery && matchesPrice && matchesMinimum
    })
  }, [ranked, criteria, query, deliveryOnly, priceOnly, minimumFitOnly])

  const selected = useMemo(
    () => selectedIds.map((id) => ranked.find((supplier) => supplier.id === id)).filter(Boolean) as Supplier[],
    [selectedIds, ranked],
  )

  const toggleSupplier = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 3 ? [...current, id] : current)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top"><span>SS</span> Supplier Scout</a>
        <nav aria-label="Основная навигация"><a href="#suppliers">Каталог</a><a href="#method">О данных</a></nav>
        <span className={`data-status ${mode}`}><i />{loadError ? 'Каталог недоступен' : meta ? `Проверено ${formatDate(meta.verified_at)}` : 'Загрузка каталога'}</span>
      </header>

      <main id="top">
        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow">Для кафе и ресторанов · кофе и чай</p>
            <h1>Выбор поставщика</h1>
            <p>Выберите категорию и город. Сравните условия и подготовьте запрос поставщику. Демо работает по проверенному каталогу, без поиска в интернете.</p>
          </div>
          <div className="search-panel">
            <label className="field category-field"><span>Что ищем</span><select aria-label="Категория" value={criteria.category} onChange={(event) => changeCriteria({ category: event.target.value as Category })}>{Object.entries(CATEGORY_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label className="field region-field"><span>Куда</span><select aria-label="Город доставки" value={criteria.region} onChange={(event) => changeCriteria({ region: event.target.value as Region })}>{(meta?.regions ?? ['Екатеринбург', 'Москва']).map((region) => <option key={region}>{region}</option>)}</select></label>
            <label className="field volume-field"><span>Объём закупки</span><span className="number-input"><input aria-label="Объём закупки, кг" type="number" min="1" max="100000" value={requestedKg} onChange={(event) => changeCriteria({ requestedKg: Math.min(100000, Math.max(1, Number(event.target.value) || 1)) })} /><b>кг</b></span></label>
            <label className="field period-field"><span>Период</span><select aria-label="Период закупки" value={criteria.period} onChange={(event) => changeCriteria({ period: event.target.value as OrderPeriod })}><option value="order">За один заказ</option><option value="month">В месяц</option></select></label>
          </div>
        </section>

        <section className="workspace" id="suppliers">
          <div className="results-heading" id="results">
            <div><h2 aria-live="polite">{loading ? 'Загружаем каталог…' : loadError ? 'Не удалось загрузить каталог' : `${filtered.length} поставщиков`}</h2><p className="results-hint">{criteria.region} · {CATEGORY_LABELS[criteria.category]}. Выберите 2–3 компании для сравнения.</p></div>
            <label className="inline-search"><span className="sr-only">Поиск по результатам</span><input placeholder="Название, город, услуга" value={query} onChange={(event) => setQuery(event.target.value)} /><span>⌕</span></label>
          </div>

          <div className="filter-row" aria-label="Фильтры">
            <button aria-pressed={deliveryOnly} className={deliveryOnly ? 'active' : ''} onClick={() => setDeliveryOnly((value) => !value)}>Доставка подтверждена</button>
            <button aria-pressed={minimumFitOnly} className={minimumFitOnly ? 'active' : ''} onClick={() => setMinimumFitOnly((value) => !value)}>Подходит объём и период</button>
            <button aria-pressed={priceOnly} className={priceOnly ? 'active' : ''} onClick={() => setPriceOnly((value) => !value)}>Цена опубликована</button>
            <span>Сначала с высокой оценкой</span>
          </div>
          <p className="catalog-note">{deliveryOnly ? 'Только компании с опубликованной доставкой в выбранный город.' : 'Включены компании, доставку которых в выбранный город ещё нужно уточнить.'} Минимумы в рублях не пересчитываются в килограммы.</p>

          <div className="supplier-head" aria-hidden="true"><span>Поставщик</span><span>Мин. заказ</span><span>Цена</span><span>Доставка</span><span>Оценка</span><span /></div>
          <div className={`supplier-list ${loading ? 'is-loading' : ''}`}>
            {filtered.map((supplier) => (
              <SupplierRow key={supplier.id} supplier={supplier} criteria={criteria} selected={selectedIds.includes(supplier.id)} selectionFull={selectedIds.length >= 3} onToggle={() => toggleSupplier(supplier.id)} onOpen={() => setDetailId(supplier.id)} />
            ))}
            {loadError && <div className="empty-state" role="alert"><p>Проверьте соединение и попробуйте снова.</p><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</button></div>}
            {!loading && !loadError && filtered.length === 0 && <div className="empty-state"><h3>Под фильтры ничего не попало</h3><p>Снимите часть условий или измените запрос. Неизвестные минимумы не проходят фильтр объёма.</p></div>}
          </div>
        </section>

        <section className="method" id="method">
          <div className="method-intro"><h2>Откуда данные и как считается оценка</h2></div>
          <div className="method-steps">
            <div><h3>Источники</h3><p>10 компаний, две категории и два города. Данные собраны вручную с официальных сайтов. Дата — проверка публикации, не подтверждение условий менеджером.</p></div>
            <div><h3>Что нужно уточнить</h3><p>Цены «от» не относятся к одинаковому товару. Документы нужно проверить для выбранной продукции. Неизвестное условие не означает отказ поставщика.</p></div>
            <div><h3>Оценка до 100 баллов</h3><p>Категория — 30, доставка — 25, подходящий объём и период — 15, источники — до 15, свежесть — до 10, цена — 5. Неизвестный минимум даёт 0. Это не оценка качества продукции.</p></div>
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

      {detail && <EvidenceDrawer supplier={detail} criteria={criteria} onClose={() => setDetailId(null)} />}
      {compareOpen && <ComparePanel
        items={selected}
        criteria={criteria}
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
