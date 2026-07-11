import {
  AlignLeft,
  Calendar,
  CalendarClock,
  CircleChevronDown,
  Clock,
  Hash,
  Link2,
  Mail,
  Phone,
  SquareCheck,
  Tags,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type {
  CellValue,
  DatabaseDef,
  DateValue,
  Field,
  FieldType,
  FilterCond,
  FilterNode,
  OptionColor,
  Page,
  SelectOption,
  TableView,
} from '../store/types'

// ---------------------------------------------------------------------------
// Field-type catalog
// ---------------------------------------------------------------------------

export const FIELD_TYPE_META: Record<FieldType, { label: string; icon: LucideIcon }> = {
  title: { label: 'Title', icon: Type },
  text: { label: 'Text', icon: AlignLeft },
  number: { label: 'Number', icon: Hash },
  select: { label: 'Select', icon: CircleChevronDown },
  multiSelect: { label: 'Multi-select', icon: Tags },
  date: { label: 'Date', icon: Calendar },
  checkbox: { label: 'Checkbox', icon: SquareCheck },
  url: { label: 'URL', icon: Link2 },
  email: { label: 'Email', icon: Mail },
  phone: { label: 'Phone', icon: Phone },
  createdTime: { label: 'Created time', icon: CalendarClock },
  updatedTime: { label: 'Edited time', icon: Clock },
}

/** Types the user can pick in menus ('title' is fixed on the first column). */
export const PICKABLE_TYPES: FieldType[] = [
  'text', 'number', 'select', 'multiSelect', 'date',
  'checkbox', 'url', 'email', 'phone', 'createdTime', 'updatedTime',
]

export const OPTION_COLORS: OptionColor[] = [
  'default', 'gray', 'brown', 'orange', 'yellow',
  'green', 'blue', 'purple', 'pink', 'red',
]

export function randomOptionColor(): OptionColor {
  const usable = OPTION_COLORS.filter(c => c !== 'default')
  return usable[Math.floor(Math.random() * usable.length)]
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createTableView(name = 'Table'): TableView {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'table',
    filter: null,
    sorts: [],
    fieldOrder: [],
    columnMeta: {},
  }
}

export function createDatabaseDef(): DatabaseDef {
  const title: Field = { id: crypto.randomUUID(), name: 'Name', type: 'title', config: {} }
  const tags: Field = { id: crypto.randomUUID(), name: 'Tags', type: 'multiSelect', config: { options: [] } }
  const view = createTableView()
  view.fieldOrder = [title.id, tags.id]
  return { fields: [title, tags], views: [view] }
}

export function defaultFieldName(type: FieldType, existing: Field[]): string {
  const base = FIELD_TYPE_META[type].label
  let candidate = base
  let n = 2
  const names = new Set(existing.map(f => f.name.toLowerCase()))
  while (names.has(candidate.toLowerCase())) candidate = `${base} ${n++}`
  return candidate
}

/** Fields in the view's column order; unknown ids skipped, new fields appended. */
export function orderedFields(db: DatabaseDef, view: TableView): Field[] {
  const byId = new Map(db.fields.map(f => [f.id, f]))
  const ordered: Field[] = []
  for (const id of view.fieldOrder) {
    const f = byId.get(id)
    if (f) {
      ordered.push(f)
      byId.delete(id)
    }
  }
  for (const f of db.fields) if (byId.has(f.id)) ordered.push(f)
  return ordered
}

// ---------------------------------------------------------------------------
// Cell access + display
// ---------------------------------------------------------------------------

/** Normalized value of a field on a row page (title/timestamps live on the page). */
export function getCell(field: Field, row: Page): CellValue {
  if (field.type === 'title') return row.title
  if (field.type === 'createdTime') return row.createdAt
  if (field.type === 'updatedTime') return row.updatedAt
  return row.props?.[field.id] ?? null
}

export function isEmptyCell(field: Field, row: Page): boolean {
  const v = getCell(field, row)
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

export function optionById(field: Field, id: string): SelectOption | undefined {
  return field.config.options?.find(o => o.id === id)
}

export function formatNumber(n: number, format?: string): string {
  switch (format) {
    case 'commas':
      return n.toLocaleString('en-US')
    case 'percent':
      return `${n.toLocaleString('en-US')}%`
    case 'currency':
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    default:
      return String(n)
  }
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const DATETIME_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})

export function formatDatePart(iso: string, includeTime?: boolean): string {
  const d = new Date(includeTime ? iso : iso + 'T00:00')
  if (Number.isNaN(d.getTime())) return iso
  return includeTime ? DATETIME_FMT.format(d) : DATE_FMT.format(d)
}

export function formatDateValue(v: DateValue): string {
  const start = formatDatePart(v.start, v.includeTime)
  return v.end ? `${start} → ${formatDatePart(v.end, v.includeTime)}` : start
}

export function formatTimestamp(ms: number): string {
  return DATETIME_FMT.format(new Date(ms))
}

const isDateValue = (v: CellValue): v is DateValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'start' in v

/** Plain-text rendering of any cell — used for display, search, filters, CSV. */
export function cellText(field: Field, row: Page): string {
  const v = getCell(field, row)
  if (v === null || v === undefined) return ''
  switch (field.type) {
    case 'number':
      return typeof v === 'number' ? formatNumber(v, field.config.numberFormat) : String(v)
    case 'select':
      return typeof v === 'string' ? optionById(field, v)?.name ?? '' : ''
    case 'multiSelect':
      return Array.isArray(v) ? v.map(id => optionById(field, id)?.name ?? '').filter(Boolean).join(', ') : ''
    case 'date':
      return isDateValue(v) ? formatDateValue(v) : ''
    case 'checkbox':
      return v === true ? 'Checked' : 'Unchecked'
    case 'createdTime':
    case 'updatedTime':
      return typeof v === 'number' ? formatTimestamp(v) : ''
    default:
      return typeof v === 'string' ? v : String(v)
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const dateMs = (v: CellValue): number => {
  if (isDateValue(v)) {
    const d = new Date(v.includeTime ? v.start : v.start + 'T00:00')
    return d.getTime()
  }
  return NaN
}

/** Per-type comparison; empty cells always sort last, both directions. */
export function compareCells(field: Field, a: Page, b: Page): number {
  const ea = isEmptyCell(field, a)
  const eb = isEmptyCell(field, b)
  if (ea && eb) return 0
  if (ea) return 1
  if (eb) return -1
  const va = getCell(field, a)
  const vb = getCell(field, b)
  switch (field.type) {
    case 'number':
    case 'createdTime':
    case 'updatedTime':
      return (va as number) - (vb as number)
    case 'checkbox':
      return (va === true ? 1 : 0) - (vb === true ? 1 : 0)
    case 'date':
      return dateMs(va) - dateMs(vb)
    case 'select': {
      // Custom option order, like Notion — not alphabetical.
      const opts = field.config.options ?? []
      return opts.findIndex(o => o.id === va) - opts.findIndex(o => o.id === vb)
    }
    case 'multiSelect': {
      const opts = field.config.options ?? []
      const seq = (v: CellValue) =>
        (Array.isArray(v) ? v : []).map(id => opts.findIndex(o => o.id === id))
      const sa = seq(va)
      const sb = seq(vb)
      for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
        const d = (sa[i] ?? -1) - (sb[i] ?? -1)
        if (d !== 0) return d
      }
      return 0
    }
    default:
      return cellText(field, a).localeCompare(cellText(field, b), undefined, { numeric: true })
  }
}

/** Multi-level sort; falls back to manual order (page.order) when no sorts. */
export function applySorts(db: DatabaseDef, view: TableView, rows: Page[]): Page[] {
  if (!view.sorts.length) return rows
  const active = view.sorts
    .map(s => ({ field: db.fields.find(f => f.id === s.fieldId), dir: s.dir }))
    .filter((s): s is { field: Field; dir: 'asc' | 'desc' } => !!s.field)
  if (!active.length) return rows
  return [...rows].sort((a, b) => {
    for (const { field, dir } of active) {
      const d = compareCells(field, a, b)
      if (d !== 0) return dir === 'asc' ? d : -d
    }
    return a.order - b.order
  })
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const isCond = (n: FilterNode | FilterCond): n is FilterCond => 'fieldId' in n

function evalCond(db: DatabaseDef, cond: FilterCond, row: Page): boolean {
  const field = db.fields.find(f => f.id === cond.fieldId)
  if (!field) return true
  const empty = isEmptyCell(field, row)
  if (cond.op === 'empty') return empty
  if (cond.op === 'notEmpty') return !empty
  if (empty) return false
  const v = getCell(field, row)
  const text = cellText(field, row).toLowerCase()
  const wanted = cond.value
  const wantedText = typeof wanted === 'string' ? wanted.toLowerCase() : ''
  switch (cond.op) {
    case 'eq':
      if (field.type === 'checkbox') return v === wanted
      if (field.type === 'number') return v === wanted
      if (field.type === 'select') return v === wanted
      if (field.type === 'date') return isDateValue(v) && typeof wanted === 'string' && v.start.slice(0, 10) === wanted
      return text === wantedText
    case 'neq':
      return !evalCond(db, { ...cond, op: 'eq' }, row)
    case 'contains':
      if (field.type === 'multiSelect') return Array.isArray(v) && typeof wanted === 'string' && v.includes(wanted)
      return text.includes(wantedText)
    case 'notContains':
      return !evalCond(db, { ...cond, op: 'contains' }, row)
    case 'startsWith':
      return text.startsWith(wantedText)
    case 'endsWith':
      return text.endsWith(wantedText)
    case 'gt':
      return typeof v === 'number' && typeof wanted === 'number' && v > wanted
    case 'lt':
      return typeof v === 'number' && typeof wanted === 'number' && v < wanted
    case 'gte':
      return typeof v === 'number' && typeof wanted === 'number' && v >= wanted
    case 'lte':
      return typeof v === 'number' && typeof wanted === 'number' && v <= wanted
    case 'before':
    case 'after':
    case 'onOrBefore':
    case 'onOrAfter': {
      const ms =
        field.type === 'createdTime' || field.type === 'updatedTime'
          ? (v as number)
          : dateMs(v)
      if (Number.isNaN(ms) || typeof wanted !== 'string') return false
      const wm = new Date(wanted + 'T00:00').getTime()
      if (cond.op === 'before') return ms < wm
      if (cond.op === 'after') return ms > wm + 86_399_999
      if (cond.op === 'onOrBefore') return ms <= wm + 86_399_999
      return ms >= wm
    }
    default:
      return true
  }
}

export function evalFilter(db: DatabaseDef, node: FilterNode | null, row: Page): boolean {
  if (!node || !node.children.length) return true
  const results = node.children.map(child =>
    isCond(child) ? evalCond(db, child, row) : evalFilter(db, child, row),
  )
  return node.conjunction === 'and' ? results.every(Boolean) : results.some(Boolean)
}

// ---------------------------------------------------------------------------
// Type conversion (column "Change type")
// ---------------------------------------------------------------------------

const findOrCreate = (
  options: SelectOption[],
  name: string,
): { options: SelectOption[]; id: string } => {
  const existing = options.find(o => o.name.toLowerCase() === name.toLowerCase())
  if (existing) return { options, id: existing.id }
  const opt: SelectOption = { id: crypto.randomUUID(), name, color: randomOptionColor() }
  return { options: [...options, opt], id: opt.id }
}

/**
 * Convert a field to a new type, best-effort migrating every row's value
 * (the convergent clone pattern: per from→to cast, unconvertible → null).
 * Returns the new field plus each row's migrated value.
 */
export function changeFieldType(
  field: Field,
  toType: FieldType,
  rows: Page[],
): { field: Field; values: Map<string, CellValue> } {
  let options: SelectOption[] =
    toType === 'select' || toType === 'multiSelect' ? [...(field.config.options ?? [])] : []
  const values = new Map<string, CellValue>()

  for (const row of rows) {
    const text = cellText(field, row).trim()
    const raw = getCell(field, row)
    let next: CellValue = null
    switch (toType) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone':
        next = text || null
        break
      case 'number': {
        const n = parseFloat(String(typeof raw === 'number' ? raw : text).replace(/[^0-9.eE+-]/g, ''))
        next = Number.isFinite(n) ? n : null
        break
      }
      case 'checkbox':
        next = raw === true || /^(true|yes|x|1|checked)$/i.test(text)
        break
      case 'date': {
        if (isDateValue(raw)) {
          next = raw
        } else {
          const ms = Date.parse(text)
          next = Number.isNaN(ms) ? null : { start: new Date(ms).toISOString().slice(0, 10) }
        }
        break
      }
      case 'select': {
        const name = field.type === 'multiSelect' && Array.isArray(raw)
          ? optionById(field, raw[0] ?? '')?.name ?? ''
          : text
        if (name) {
          const r = findOrCreate(options, name)
          options = r.options
          next = r.id
        }
        break
      }
      case 'multiSelect': {
        const names =
          field.type === 'select' && typeof raw === 'string'
            ? [optionById(field, raw)?.name ?? ''].filter(Boolean)
            : text.split(',').map(s => s.trim()).filter(Boolean)
        if (names.length) {
          const ids: string[] = []
          for (const name of names) {
            const r = findOrCreate(options, name)
            options = r.options
            ids.push(r.id)
          }
          next = ids
        }
        break
      }
      default:
        next = null // createdTime/updatedTime read from the page itself
    }
    values.set(row.id, next)
  }

  // Same-family conversions keep values untouched where they already fit.
  if (toType === field.type) {
    for (const row of rows) values.set(row.id, getCell(field, row))
  }

  const config: Field['config'] = {}
  if (toType === 'select' || toType === 'multiSelect') config.options = options
  if (toType === 'number') config.numberFormat = field.config.numberFormat ?? 'plain'
  return { field: { ...field, type: toType, config }, values }
}
