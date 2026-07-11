import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  Check,
  ChevronRight,
  CopyPlus,
  EyeOff,
  Plus,
  Trash2,
  WrapText,
  X,
} from 'lucide-react'
import { useStore } from '../../store/store'
import type { Field, FieldType, TableView } from '../../store/types'
import { FIELD_TYPE_META, OPTION_COLORS, PICKABLE_TYPES, randomOptionColor } from '../../lib/db'
import { cx } from '../../lib/util'
import { Menu, Popover, type MenuEntry } from '../Popover'

export function FieldMenu({
  dbId,
  view,
  field,
  anchor,
  onClose,
}: {
  dbId: string
  view: TableView
  field: Field
  anchor: DOMRect
  onClose: () => void
}) {
  const dbUpdate = useStore(s => s.dbUpdate)
  const dbUpdateView = useStore(s => s.dbUpdateView)
  const dbSetColumnMeta = useStore(s => s.dbSetColumnMeta)
  const dbChangeFieldType = useStore(s => s.dbChangeFieldType)
  const dbDuplicateField = useStore(s => s.dbDuplicateField)
  const dbRemoveField = useStore(s => s.dbRemoveField)
  const dbAddField = useStore(s => s.dbAddField)

  const [name, setName] = useState(field.name)
  const [typeOpen, setTypeOpen] = useState(false)
  const [newOption, setNewOption] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  // Deferred: the Popover is visibility:hidden until positioned.
  useEffect(() => {
    const t = window.setTimeout(() => nameRef.current?.select(), 0)
    return () => window.clearTimeout(t)
  }, [])

  const isTitle = field.type === 'title'
  const meta = view.columnMeta[field.id]
  const TypeIcon = FIELD_TYPE_META[field.type].icon

  const rename = () => {
    const clean = name.trim()
    if (clean && clean !== field.name) {
      dbUpdate(dbId, db => ({
        ...db,
        fields: db.fields.map(f => (f.id === field.id ? { ...f, name: clean } : f)),
      }))
    }
  }

  const patchOptions = (fn: (opts: NonNullable<Field['config']['options']>) => NonNullable<Field['config']['options']>) =>
    dbUpdate(dbId, db => ({
      ...db,
      fields: db.fields.map(f =>
        f.id === field.id ? { ...f, config: { ...f.config, options: fn(f.config.options ?? []) } } : f,
      ),
    }))

  const sortEntry = (dir: 'asc' | 'desc'): MenuEntry => {
    const active = view.sorts.length === 1 && view.sorts[0].fieldId === field.id && view.sorts[0].dir === dir
    return {
      icon: dir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow,
      label: dir === 'asc' ? 'Sort ascending' : 'Sort descending',
      active,
      onSelect: () => {
        dbUpdateView(dbId, view.id, { sorts: active ? [] : [{ fieldId: field.id, dir }] })
        onClose()
      },
    }
  }

  const entries: MenuEntry[] = [
    sortEntry('asc'),
    sortEntry('desc'),
    ...(isTitle
      ? []
      : ([
          { kind: 'sep' },
          {
            icon: ArrowLeftToLine,
            label: 'Insert left',
            onSelect: () => {
              dbAddField(dbId, 'text', { beforeId: field.id })
              onClose()
            },
          },
          {
            icon: ArrowRightToLine,
            label: 'Insert right',
            onSelect: () => {
              dbAddField(dbId, 'text', { afterId: field.id })
              onClose()
            },
          },
          {
            icon: WrapText,
            label: 'Wrap text',
            active: !!meta?.wrap,
            onSelect: () => {
              dbSetColumnMeta(dbId, view.id, field.id, { wrap: !meta?.wrap })
              onClose()
            },
          },
          { icon: CopyPlus, label: 'Duplicate property', onSelect: () => { dbDuplicateField(dbId, field.id); onClose() } },
          { icon: EyeOff, label: 'Hide in view', onSelect: () => { dbSetColumnMeta(dbId, view.id, field.id, { hidden: true }); onClose() } },
          { kind: 'sep' },
          { icon: Trash2, label: 'Delete property', danger: true, onSelect: () => { dbRemoveField(dbId, field.id); onClose() } },
        ] as MenuEntry[])),
  ]

  return (
    <Popover anchor={anchor} onClose={() => { rename(); onClose() }} className="db-fieldmenu">
      <div className="db-fm-name">
        <input
          ref={nameRef}
          value={name}
          spellCheck={false}
          onChange={e => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              rename()
              onClose()
            }
          }}
        />
      </div>

      {!isTitle && (
        <>
          <button type="button" className="db-fm-type" onClick={() => setTypeOpen(o => !o)}>
            <span className="db-fm-type-label">
              <TypeIcon size={14} strokeWidth={1.7} />
              {FIELD_TYPE_META[field.type].label}
            </span>
            <ChevronRight size={13} strokeWidth={1.8} className={cx('db-fm-chev', typeOpen && 'is-open')} />
          </button>
          {typeOpen && (
            <div className="db-fm-types">
              {PICKABLE_TYPES.map(t => {
                const Icon = FIELD_TYPE_META[t].icon
                return (
                  <button
                    key={t}
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      dbChangeFieldType(dbId, field.id, t as FieldType)
                      setTypeOpen(false)
                    }}
                  >
                    <Icon size={15} strokeWidth={1.7} />
                    <span className="menu-label">{FIELD_TYPE_META[t].label}</span>
                    {field.type === t && <Check size={14} strokeWidth={2.2} className="menu-check" />}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {field.type === 'number' && (
        <div className="db-fm-formats">
          {(['plain', 'commas', 'percent', 'currency'] as const).map(fmt => (
            <button
              key={fmt}
              type="button"
              className={cx('db-fm-format', (field.config.numberFormat ?? 'plain') === fmt && 'is-active')}
              onClick={() =>
                dbUpdate(dbId, db => ({
                  ...db,
                  fields: db.fields.map(f =>
                    f.id === field.id ? { ...f, config: { ...f.config, numberFormat: fmt } } : f,
                  ),
                }))
              }
            >
              {fmt === 'plain' ? '42' : fmt === 'commas' ? '1,000' : fmt === 'percent' ? '42%' : '$42'}
            </button>
          ))}
        </div>
      )}

      {(field.type === 'select' || field.type === 'multiSelect') && (
        <div className="db-fm-options">
          <div className="menu-note">Options</div>
          {(field.config.options ?? []).map(o => (
            <div key={o.id} className="db-fm-option">
              <button
                type="button"
                className={cx('db-fm-dot', 'dbo-' + o.color)}
                title="Change color"
                onClick={() =>
                  patchOptions(opts =>
                    opts.map(x =>
                      x.id === o.id
                        ? {
                            ...x,
                            color:
                              OPTION_COLORS[(OPTION_COLORS.indexOf(x.color) + 1) % OPTION_COLORS.length],
                          }
                        : x,
                    ),
                  )
                }
              />
              <input
                className="db-fm-optname"
                value={o.name}
                spellCheck={false}
                onChange={e =>
                  patchOptions(opts => opts.map(x => (x.id === o.id ? { ...x, name: e.target.value } : x)))
                }
              />
              <button
                type="button"
                className="icon-btn sm db-fm-optdel"
                title="Delete option"
                onClick={() => patchOptions(opts => opts.filter(x => x.id !== o.id))}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
          <div className="db-fm-option db-fm-addopt">
            <Plus size={13} strokeWidth={1.8} />
            <input
              className="db-fm-optname"
              value={newOption}
              placeholder="Add an option"
              spellCheck={false}
              onChange={e => setNewOption(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter' && newOption.trim()) {
                  patchOptions(opts => [
                    ...opts,
                    { id: crypto.randomUUID(), name: newOption.trim(), color: randomOptionColor() },
                  ])
                  setNewOption('')
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="menu-sep" />
      <Menu entries={entries} />
    </Popover>
  )
}
