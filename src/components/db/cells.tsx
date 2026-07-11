import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useStore } from '../../store/store'
import type { CellValue, DateValue, Field, Page, SelectOption } from '../../store/types'
import {
  cellText,
  formatNumber,
  formatTimestamp,
  optionById,
  randomOptionColor,
} from '../../lib/db'
import { cx } from '../../lib/util'
import { Popover } from '../Popover'

/** Commit helper: title lives on the page, everything else in props. */
function useCommit(field: Field, row: Page) {
  const dbSetCell = useStore(s => s.dbSetCell)
  const updateTitle = useStore(s => s.updateTitle)
  return (value: CellValue) => {
    if (field.type === 'title') updateTitle(row.id, typeof value === 'string' ? value : '')
    else dbSetCell(row.id, field.id, value)
  }
}

// ---------------------------------------------------------------------------
// Text-family editor (title, text, number, url, email, phone)
// ---------------------------------------------------------------------------

function TextEditor({
  field,
  row,
  onDone,
}: {
  field: Field
  row: Page
  onDone: (move?: 1 | -1) => void
}) {
  const commit = useCommit(field, row)
  const raw =
    field.type === 'title'
      ? row.title
      : field.type === 'number'
        ? (row.props?.[field.id] as number | undefined)?.toString() ?? ''
        : ((row.props?.[field.id] as string | undefined) ?? '')
  const [draft, setDraft] = useState(raw)
  const ref = useRef<HTMLInputElement>(null)
  // Keydown finishes the edit, then the input blurs as it unmounts — the
  // blur must not fire onDone a second time (it would close the next cell).
  const finished = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const save = () => {
    if (field.type === 'number') {
      const n = parseFloat(draft.replace(/,/g, ''))
      commit(Number.isFinite(n) ? n : null)
    } else {
      commit(draft.trim() ? draft : field.type === 'title' ? '' : null)
    }
  }

  const finish = (saveIt: boolean, move?: 1 | -1) => {
    if (finished.current) return
    finished.current = true
    if (saveIt) save()
    onDone(move)
  }

  return (
    <input
      ref={ref}
      className="dbc-input"
      value={draft}
      spellCheck={false}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          finish(true)
        } else if (e.key === 'Escape') {
          finish(false)
        } else if (e.key === 'Tab') {
          e.preventDefault()
          finish(true, e.shiftKey ? -1 : 1)
        }
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Select / multi-select picker
// ---------------------------------------------------------------------------

function OptionChip({ option, onRemove }: { option: SelectOption; onRemove?: () => void }) {
  return (
    <span className={cx('db-chip', 'dbo-' + option.color)}>
      {option.name}
      {onRemove && (
        <button
          type="button"
          className="db-chip-x"
          onMouseDown={e => e.preventDefault()}
          onClick={e => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X size={11} strokeWidth={2.2} />
        </button>
      )}
    </span>
  )
}

function OptionPicker({
  dbId,
  field,
  row,
  anchor,
  multi,
  onClose,
}: {
  dbId: string
  field: Field
  row: Page
  anchor: DOMRect
  multi: boolean
  onClose: () => void
}) {
  const commit = useCommit(field, row)
  const dbUpdate = useStore(s => s.dbUpdate)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // The Popover is visibility:hidden until measured, and hidden inputs
  // silently refuse focus — defer past the positioning pass.
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  const value = row.props?.[field.id]
  const selected: string[] = multi
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === 'string'
      ? [value]
      : []

  const options = field.config.options ?? []
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter(o => o.name.toLowerCase().includes(q)) : options
  const exact = options.some(o => o.name.toLowerCase() === q)

  const pick = (id: string) => {
    if (multi) {
      commit(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
      setQuery('')
      inputRef.current?.focus()
    } else {
      commit(selected[0] === id ? null : id)
      onClose()
    }
  }

  const createOption = () => {
    const name = query.trim()
    if (!name) return
    const opt: SelectOption = { id: crypto.randomUUID(), name, color: randomOptionColor() }
    dbUpdate(dbId, db => ({
      ...db,
      fields: db.fields.map(f =>
        f.id === field.id
          ? { ...f, config: { ...f.config, options: [...(f.config.options ?? []), opt] } }
          : f,
      ),
    }))
    pick(opt.id)
  }

  return (
    <Popover anchor={anchor} onClose={onClose} className="db-picker">
      <div className="db-picker-head">
        {selected.map(id => {
          const o = optionById(field, id)
          return o ? (
            <OptionChip key={id} option={o} onRemove={() => pick(id)} />
          ) : null
        })}
        <input
          ref={inputRef}
          className="db-picker-input"
          value={query}
          placeholder={selected.length ? '' : 'Search or create…'}
          spellCheck={false}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              if (shown[0]) pick(shown[0].id)
              else if (q) createOption()
            } else if (e.key === 'Escape') {
              onClose()
            } else if (e.key === 'Backspace' && !query && multi && selected.length) {
              pick(selected[selected.length - 1])
            }
          }}
        />
      </div>
      <div className="db-picker-list">
        {shown.map(o => (
          <button
            key={o.id}
            type="button"
            className="db-picker-row"
            onMouseDown={e => e.preventDefault()}
            onClick={() => pick(o.id)}
          >
            <span className={cx('db-chip', 'dbo-' + o.color)}>{o.name}</span>
            {selected.includes(o.id) && <Check size={13} strokeWidth={2.2} className="db-picker-check" />}
          </button>
        ))}
        {q && !exact && (
          <button
            type="button"
            className="db-picker-row"
            onMouseDown={e => e.preventDefault()}
            onClick={createOption}
          >
            <span className="db-picker-create">Create</span>
            <span className="db-chip dbo-default">{query.trim()}</span>
          </button>
        )}
        {!shown.length && !q && <div className="db-picker-empty">No options yet — type to create one</div>}
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Date picker
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function DatePicker({
  field,
  row,
  anchor,
  onClose,
}: {
  field: Field
  row: Page
  anchor: DOMRect
  onClose: () => void
}) {
  const commit = useCommit(field, row)
  const value = row.props?.[field.id] as DateValue | undefined
  const start = value?.start?.slice(0, 10)
  const end = value?.end?.slice(0, 10)
  const [cursor, setCursor] = useState(() => {
    const base = start ? new Date(start + 'T00:00') : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const [ranged, setRanged] = useState(!!end)
  const [withTime, setWithTime] = useState(!!value?.includeTime)

  const timeOf = (iso?: string) => (iso && iso.includes('T') ? iso.slice(11, 16) : '09:00')

  const put = (next: Partial<DateValue> & { start?: string | null }) => {
    const merged: DateValue | null =
      next.start === null
        ? null
        : {
            start: next.start ?? value?.start ?? isoDate(new Date()),
            ...(next.end !== undefined ? (next.end ? { end: next.end } : {}) : end ? { end: value?.end } : {}),
            ...((next.includeTime ?? withTime) ? { includeTime: true } : {}),
          }
    commit(merged)
  }

  const pickDay = (iso: string) => {
    const t = withTime ? 'T' + timeOf(value?.start) : ''
    if (ranged && start && !end && iso >= start) {
      put({ end: iso + (withTime ? 'T' + timeOf(value?.end) : '') })
    } else {
      commit({
        start: iso + t,
        ...(withTime ? { includeTime: true } : {}),
      })
    }
  }

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const days: (string | null)[] = Array(first.getDay()).fill(null)
  const dim = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  for (let d = 1; d <= dim; d++) days.push(isoDate(new Date(cursor.getFullYear(), cursor.getMonth(), d)))
  const today = isoDate(new Date())

  return (
    <Popover anchor={anchor} onClose={onClose} className="db-datepick">
      <div className="db-date-nav">
        <span className="db-date-month">{MONTH_FMT.format(cursor)}</span>
        <span className="db-date-arrows">
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      <div className="db-date-grid">
        {DOW.map(d => (
          <span key={d} className="db-date-dow">
            {d}
          </span>
        ))}
        {days.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              className={cx(
                'db-date-day',
                iso === today && 'is-today',
                (iso === start || iso === end) && 'is-picked',
                start && end && iso > start && iso < end && 'is-between',
              )}
              onClick={() => pickDay(iso)}
            >
              {Number(iso.slice(8))}
            </button>
          ) : (
            <span key={'pad' + i} />
          ),
        )}
      </div>
      {withTime && start && (
        <div className="db-date-times">
          <input
            className="db-date-time"
            type="time"
            value={timeOf(value?.start)}
            onChange={e => put({ start: start + 'T' + (e.target.value || '00:00'), includeTime: true })}
          />
          {end && (
            <input
              className="db-date-time"
              type="time"
              value={timeOf(value?.end)}
              onChange={e => put({ end: end + 'T' + (e.target.value || '00:00'), includeTime: true })}
            />
          )}
        </div>
      )}
      <div className="db-date-opts">
        <button
          type="button"
          className={cx('db-date-opt', ranged && 'is-on')}
          onClick={() => {
            if (ranged && value) put({ end: undefined, start: value.start })
            if (ranged && value?.end) commit({ start: value.start, ...(withTime ? { includeTime: true } : {}) })
            setRanged(!ranged)
          }}
        >
          End date
        </button>
        <button
          type="button"
          className={cx('db-date-opt', withTime && 'is-on')}
          onClick={() => {
            const on = !withTime
            setWithTime(on)
            if (value) {
              commit(
                on
                  ? { ...value, start: value.start.slice(0, 10) + 'T' + timeOf(value.start), includeTime: true }
                  : {
                      start: value.start.slice(0, 10),
                      ...(value.end ? { end: value.end.slice(0, 10) } : {}),
                    },
              )
            }
          }}
        >
          Include time
        </button>
        <button
          type="button"
          className="db-date-opt db-date-clear"
          onClick={() => {
            commit(null)
            onClose()
          }}
        >
          Clear
        </button>
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// The cell
// ---------------------------------------------------------------------------

export function Cell({
  dbId,
  field,
  row,
  wrap,
  editing,
  onEdit,
  onDone,
  onOpenRow,
}: {
  dbId: string
  field: Field
  row: Page
  wrap: boolean
  editing: boolean
  onEdit: (rect: DOMRect) => void
  onDone: (move?: 1 | -1) => void
  onOpenRow?: () => void
}) {
  const commit = useCommit(field, row)
  const ref = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  // Popover editors anchor to the cell; measured when editing begins.
  useEffect(() => {
    if (editing && ref.current) setAnchor(ref.current.getBoundingClientRect())
    else setAnchor(null)
  }, [editing])

  const value = row.props?.[field.id]

  if (field.type === 'checkbox') {
    const checked = value === true
    return (
      <div className={cx('dbt-cell', 'is-checkbox')}>
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          className={cx('db-check', checked && 'is-checked')}
          onClick={() => commit(!checked)}
        >
          {checked && <Check size={12} strokeWidth={3} />}
        </button>
      </div>
    )
  }

  const readonly = field.type === 'createdTime' || field.type === 'updatedTime'
  const text = cellText(field, row)

  const body = () => {
    if (editing && (field.type === 'title' || field.type === 'text' || field.type === 'number' || field.type === 'url' || field.type === 'email' || field.type === 'phone')) {
      return <TextEditor field={field} row={row} onDone={onDone} />
    }
    switch (field.type) {
      case 'select': {
        const o = typeof value === 'string' ? optionById(field, value) : undefined
        return o ? <OptionChip option={o} /> : null
      }
      case 'multiSelect': {
        const ids = Array.isArray(value) ? value : []
        return ids.length ? (
          <span className="db-chips">
            {ids.map(id => {
              const o = optionById(field, id)
              return o ? <OptionChip key={id} option={o} /> : null
            })}
          </span>
        ) : null
      }
      case 'number':
        return typeof value === 'number' ? (
          <span className="dbc-text">{formatNumber(value, field.config.numberFormat)}</span>
        ) : null
      case 'url':
        return typeof value === 'string' && value ? (
          <span className="dbc-text dbc-link">{value}</span>
        ) : null
      case 'createdTime':
        return <span className="dbc-text dbc-dim">{formatTimestamp(row.createdAt)}</span>
      case 'updatedTime':
        return <span className="dbc-text dbc-dim">{formatTimestamp(row.updatedAt)}</span>
      case 'title':
        return <span className="dbc-text dbc-title">{row.title || <span className="dbc-ghost">Untitled</span>}</span>
      default:
        return text ? <span className="dbc-text">{text}</span> : null
    }
  }

  return (
    <div
      ref={ref}
      className={cx('dbt-cell', wrap && 'is-wrap', editing && 'is-editing', readonly && 'is-readonly')}
      onClick={() => {
        if (readonly || editing) return
        if (ref.current) onEdit(ref.current.getBoundingClientRect())
      }}
    >
      {body()}
      {field.type === 'url' && typeof value === 'string' && value && !editing && (
        <button
          type="button"
          className="dbc-open dbc-linkout"
          title="Open link"
          onClick={e => {
            e.stopPropagation()
            window.open(/^https?:\/\//.test(value) ? value : 'https://' + value, '_blank', 'noopener')
          }}
        >
          <ArrowUpRight size={13} strokeWidth={2} />
        </button>
      )}
      {field.type === 'title' && onOpenRow && !editing && (
        <button
          type="button"
          className="dbc-open"
          onClick={e => {
            e.stopPropagation()
            onOpenRow()
          }}
        >
          <ArrowUpRight size={12} strokeWidth={2} />
          Open
        </button>
      )}
      {editing && anchor && field.type === 'select' && (
        <OptionPicker dbId={dbId} field={field} row={row} anchor={anchor} multi={false} onClose={onDone} />
      )}
      {editing && anchor && field.type === 'multiSelect' && (
        <OptionPicker dbId={dbId} field={field} row={row} anchor={anchor} multi onClose={onDone} />
      )}
      {editing && anchor && field.type === 'date' && (
        <DatePicker field={field} row={row} anchor={anchor} onClose={onDone} />
      )}
    </div>
  )
}
