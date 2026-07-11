import { useState } from 'react'
import { useStore } from '../../store/store'
import type { Page } from '../../store/types'
import { FIELD_TYPE_META, orderedFields } from '../../lib/db'
import { Cell } from './cells'

/** The Notion-style property list at the top of a row's page. */
export function RowPageProps({ page }: { page: Page }) {
  const parent = useStore(s => (page.parentId ? s.pages[page.parentId] : undefined))
  const [editing, setEditing] = useState<string | null>(null)

  const db = parent?.db
  const view = db?.views[0]
  if (!db || !view || !parent) return null

  const fields = orderedFields(db, view).filter(f => f.type !== 'title')
  if (!fields.length) return null

  return (
    <div className="db-rowprops" contentEditable={false}>
      {fields.map(f => {
        const Icon = FIELD_TYPE_META[f.type].icon
        return (
          <div key={f.id} className="db-rowprop">
            <span className="db-rowprop-name">
              <Icon size={13.5} strokeWidth={1.7} />
              {f.name}
            </span>
            <div className="db-rowprop-value">
              <Cell
                dbId={parent.id}
                field={f}
                row={page}
                wrap
                editing={editing === f.id}
                onEdit={() => setEditing(f.id)}
                onDone={() => setEditing(null)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
