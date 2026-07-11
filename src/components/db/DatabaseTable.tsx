import { useLayoutEffect, useRef, useState } from 'react'
import { EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../../store/store'
import type { Field, Page } from '../../store/types'
import { FIELD_TYPE_META, applySorts, evalFilter, orderedFields } from '../../lib/db'
import { childrenOf } from '../../lib/tree'
import { cx } from '../../lib/util'
import { Menu, Popover } from '../Popover'
import { Cell } from './cells'
import { FieldMenu } from './FieldMenu'

const DEFAULT_WIDTH = 170
const TITLE_WIDTH = 260
const MIN_WIDTH = 90

export function DatabaseTable({ dbId, inline }: { dbId: string; inline?: boolean }) {
  const pages = useStore(s => s.pages)
  const dbAddRow = useStore(s => s.dbAddRow)
  const dbDeleteRows = useStore(s => s.dbDeleteRows)
  const dbAddField = useStore(s => s.dbAddField)
  const dbSetColumnMeta = useStore(s => s.dbSetColumnMeta)
  const dbUpdateView = useStore(s => s.dbUpdateView)
  const movePage = useStore(s => s.movePage)
  const setPeek = useStore(s => s.setPeek)

  const [editing, setEditing] = useState<{ rowId: string; fieldId: string } | null>(null)
  const [fieldMenu, setFieldMenu] = useState<{ fieldId: string; at: DOMRect } | null>(null)
  const [pendingMenu, setPendingMenu] = useState<string | null>(null)
  const [hiddenMenu, setHiddenMenu] = useState<DOMRect | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hoverRow, setHoverRow] = useState<{ id: string; top: number } | null>(null)
  // The gutter floats left of the table — clearing it instantly on mouseleave
  // makes it vanish mid-reach, so hide on a short grace period instead.
  const gutterTimer = useRef<number | undefined>(undefined)
  const keepGutter = () => window.clearTimeout(gutterTimer.current)
  const scheduleGutterHide = () => {
    window.clearTimeout(gutterTimer.current)
    gutterTimer.current = window.setTimeout(() => setHoverRow(null), 250)
  }
  const [resize, setResize] = useState<{ fieldId: string; width: number } | null>(null)
  const [colDrop, setColDrop] = useState<number | null>(null)
  const [rowDrop, setRowDrop] = useState<{ id: string; after: boolean; top: number } | null>(null)
  const [draggingRow, setDraggingRow] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const dbPage = pages[dbId]
  const db = dbPage?.db
  const view = db?.views[0]

  // A freshly added column opens its menu once the header exists.
  useLayoutEffect(() => {
    if (!pendingMenu || !headRef.current) return
    const el = headRef.current.querySelector<HTMLElement>(`[data-field-id="${pendingMenu}"]`)
    if (el) setFieldMenu({ fieldId: pendingMenu, at: el.getBoundingClientRect() })
    setPendingMenu(null)
  }, [pendingMenu])

  if (!db || !view) return null

  const fields = orderedFields(db, view)
  const visible = fields.filter(f => !view.columnMeta[f.id]?.hidden)
  const hidden = fields.filter(f => view.columnMeta[f.id]?.hidden)
  const allRows = childrenOf(pages, dbId)
  const rows = applySorts(db, view, allRows.filter(r => evalFilter(db, view.filter, r)))
  const isSorted = view.sorts.length > 0
  const titleField = fields.find(f => f.type === 'title')

  const widthOf = (f: Field) =>
    resize?.fieldId === f.id
      ? resize.width
      : view.columnMeta[f.id]?.width ?? (f.type === 'title' ? TITLE_WIDTH : DEFAULT_WIDTH)

  // ----- column resize -----

  const startResize = (e: React.PointerEvent, field: Field) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthOf(field)
    const width = (ev: PointerEvent) => Math.max(MIN_WIDTH, startW + ev.clientX - startX)
    const move = (ev: PointerEvent) => setResize({ fieldId: field.id, width: width(ev) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      dbSetColumnMeta(dbId, view.id, field.id, { width: width(ev) })
      setResize(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  // ----- column click (menu) vs drag (reorder) -----

  const headerCellRects = () =>
    Array.from(headRef.current?.querySelectorAll<HTMLElement>('.dbt-th') ?? []).map(el => ({
      id: el.dataset.fieldId!,
      rect: el.getBoundingClientRect(),
    }))

  const onHeaderPointerDown = (e: React.PointerEvent, field: Field) => {
    if ((e.target as HTMLElement).closest('.dbt-resizer')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const headRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let dragging = false

    const insertionIndex = (x: number) => {
      const cells = headerCellRects()
      for (let i = 0; i < cells.length; i++) {
        if (x < cells[i].rect.left + cells[i].rect.width / 2) return i
      }
      return cells.length
    }

    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) dragging = true
      if (dragging) setColDrop(insertionIndex(ev.clientX))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      setColDrop(null)
      if (!dragging) {
        setFieldMenu({ fieldId: field.id, at: headRect })
        return
      }
      const at = insertionIndex(ev.clientX)
      const without = visible.filter(f => f.id !== field.id)
      const visIndex = Math.min(at > visible.findIndex(f => f.id === field.id) ? at - 1 : at, without.length)
      const newVisible = [...without.slice(0, visIndex), field, ...without.slice(visIndex)]
      // Weave hidden fields back in at the end so nothing is lost.
      dbUpdateView(dbId, view.id, { fieldOrder: [...newVisible.map(f => f.id), ...hidden.map(f => f.id)] })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  // ----- row drag -----

  const rowRects = () =>
    Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-row-id]') ?? []).map(el => ({
      id: el.dataset.rowId!,
      top: el.offsetTop,
      rect: el.getBoundingClientRect(),
      height: el.offsetHeight,
    }))

  const onGripPointerDown = (e: React.PointerEvent, rowId: string) => {
    if (isSorted) return
    e.preventDefault()
    setDraggingRow(rowId)
    const target = (ev: PointerEvent) => {
      const rects = rowRects()
      for (const r of rects) {
        if (ev.clientY < r.rect.top + r.rect.height / 2) {
          return { id: r.id, after: false, top: r.top }
        }
      }
      const last = rects[rects.length - 1]
      return last ? { id: last.id, after: true, top: last.top + last.height } : null
    }
    const move = (ev: PointerEvent) => setRowDrop(target(ev))
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      const t = target(ev)
      setRowDrop(null)
      setDraggingRow(null)
      if (t && t.id !== rowId) movePage(rowId, { type: t.after ? 'after' : 'before', id: t.id })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  // ----- editing flow -----

  const editableTypes = new Set([
    'title', 'text', 'number', 'select', 'multiSelect', 'date', 'url', 'email', 'phone',
  ])

  const doneEditing = (move?: 1 | -1) => {
    if (!move || !editing) {
      setEditing(null)
      return
    }
    const rowIndex = rows.findIndex(r => r.id === editing.rowId)
    const editCols = visible.filter(f => editableTypes.has(f.type))
    let col = editCols.findIndex(f => f.id === editing.fieldId) + move
    let row = rowIndex
    if (col >= editCols.length) {
      col = 0
      row++
    } else if (col < 0) {
      col = editCols.length - 1
      row--
    }
    const nextRow = rows[row]
    setEditing(nextRow ? { rowId: nextRow.id, fieldId: editCols[col].id } : null)
  }

  const addRow = (afterId?: string) => {
    const id = dbAddRow(dbId, afterId ? { afterId } : undefined)
    if (titleField) setEditing({ rowId: id, fieldId: titleField.id })
  }

  const toggleSelect = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const totalWidth = visible.reduce((sum, f) => sum + widthOf(f), 0)

  return (
    <div
      ref={rootRef}
      className={cx('dbt', inline && 'is-inline')}
      onMouseLeave={scheduleGutterHide}
    >
      {/* hover gutter: checkbox + drag grip, floating left of the row */}
      {hoverRow && !draggingRow && (
        <div
          className="dbt-gutter"
          style={{ top: hoverRow.top }}
          onMouseEnter={keepGutter}
          onMouseLeave={scheduleGutterHide}
        >
          <button
            type="button"
            className={cx('dbt-rowcheck', selected.has(hoverRow.id) && 'is-checked')}
            title="Select row"
            onClick={() => toggleSelect(hoverRow.id)}
          />
          <button
            type="button"
            className={cx('dbt-grip', isSorted && 'is-disabled')}
            title={isSorted ? 'Manual order is off while sorted' : 'Drag to move'}
            onPointerDown={e => onGripPointerDown(e, hoverRow.id)}
          >
            <GripVertical size={13} strokeWidth={1.8} />
          </button>
        </div>
      )}

      <div className="dbt-scroll">
        <div className="dbt-inner" style={{ width: totalWidth + 40 }}>
          <div className="dbt-head" ref={headRef}>
            {visible.map((f, i) => {
              const Icon = FIELD_TYPE_META[f.type].icon
              return (
                <div
                  key={f.id}
                  className={cx('dbt-th', view.sorts.some(s => s.fieldId === f.id) && 'is-sorted')}
                  data-field-id={f.id}
                  style={{ width: widthOf(f) }}
                  onPointerDown={e => onHeaderPointerDown(e, f)}
                >
                  <Icon size={13.5} strokeWidth={1.7} className="dbt-th-icon" />
                  <span className="dbt-th-name">{f.name}</span>
                  <div className="dbt-resizer" onPointerDown={e => startResize(e, f)} />
                  {colDrop === i && <div className="dbt-coldrop" />}
                </div>
              )
            })}
            {colDrop === visible.length && <div className="dbt-coldrop is-end" />}
            <div className="dbt-head-tools">
              {hidden.length > 0 && (
                <button
                  type="button"
                  className="dbt-addcol"
                  title={`${hidden.length} hidden ${hidden.length === 1 ? 'property' : 'properties'}`}
                  onClick={e => setHiddenMenu(e.currentTarget.getBoundingClientRect())}
                >
                  <EyeOff size={13} strokeWidth={1.7} />
                </button>
              )}
              <button
                type="button"
                className="dbt-addcol"
                title="Add a property"
                onClick={() => setPendingMenu(dbAddField(dbId, 'text'))}
              >
                <Plus size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="dbt-body" ref={bodyRef}>
            {rows.map(row => (
              <div
                key={row.id}
                className={cx(
                  'dbt-row',
                  selected.has(row.id) && 'is-selected',
                  draggingRow === row.id && 'is-dragging',
                )}
                data-row-id={row.id}
                onMouseEnter={e => {
                  keepGutter()
                  // Row offsets are relative to the positioned .dbt-body; the
                  // gutter is positioned against .dbt, so add the body offset.
                  setHoverRow({
                    id: row.id,
                    top: e.currentTarget.offsetTop + (bodyRef.current?.offsetTop ?? 0),
                  })
                }}
              >
                {visible.map(f => (
                  <div key={f.id} className="dbt-cellwrap" style={{ width: widthOf(f) }}>
                    <Cell
                      dbId={dbId}
                      field={f}
                      row={row}
                      wrap={!!view.columnMeta[f.id]?.wrap}
                      editing={editing?.rowId === row.id && editing?.fieldId === f.id}
                      onEdit={() =>
                        editableTypes.has(f.type) && setEditing({ rowId: row.id, fieldId: f.id })
                      }
                      onDone={doneEditing}
                      onOpenRow={f.type === 'title' ? () => setPeek(row.id) : undefined}
                    />
                  </div>
                ))}
              </div>
            ))}
            {rowDrop && <div className="dbt-rowdrop" style={{ top: rowDrop.top }} />}
          </div>

          <button type="button" className="dbt-newrow" onClick={() => addRow()}>
            <Plus size={14} strokeWidth={1.8} />
            New
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="dbt-bulk">
          <span className="dbt-bulk-count">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="dbt-bulk-btn is-danger"
            onClick={() => {
              dbDeleteRows([...selected])
              setSelected(new Set())
            }}
          >
            <Trash2 size={13} strokeWidth={1.8} />
            Delete
          </button>
          <button type="button" className="dbt-bulk-btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {fieldMenu && (
        <FieldMenu
          dbId={dbId}
          view={view}
          field={fields.find(f => f.id === fieldMenu.fieldId)!}
          anchor={fieldMenu.at}
          onClose={() => setFieldMenu(null)}
        />
      )}

      {hiddenMenu && (
        <Popover anchor={hiddenMenu} onClose={() => setHiddenMenu(null)}>
          <div className="menu-note">Hidden properties</div>
          <Menu
            entries={hidden.map(f => ({
              icon: FIELD_TYPE_META[f.type].icon,
              label: f.name,
              onSelect: () => {
                dbSetColumnMeta(dbId, view.id, f.id, { hidden: false })
                setHiddenMenu(null)
              },
            }))}
          />
        </Popover>
      )}
    </div>
  )
}
