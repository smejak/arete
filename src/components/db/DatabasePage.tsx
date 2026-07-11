import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../../store/store'
import { EmojiPicker } from '../EmojiPicker'
import { DatabaseTable } from './DatabaseTable'

/** Full-page database: the whole page IS the table (like Notion). */
export function DatabasePage({ pageId }: { pageId: string }) {
  const page = useStore(s => s.pages[pageId])
  const updateTitle = useStore(s => s.updateTitle)
  const setIcon = useStore(s => s.setIcon)
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = titleRef.current
    if (el) {
      el.style.height = '0px'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [page?.title])

  if (!page) return null

  return (
    <div className="page-scroll">
      <div className="db-fullpage">
        <div className="page-head">
          {page.icon && (
            <button
              type="button"
              className="page-icon"
              title="Change icon"
              onClick={e => setIconPicker(e.currentTarget.getBoundingClientRect())}
            >
              {page.icon}
            </button>
          )}
          <textarea
            ref={titleRef}
            className="page-title"
            rows={1}
            value={page.title}
            placeholder="Untitled"
            spellCheck={false}
            onChange={e => updateTitle(page.id, e.target.value)}
          />
        </div>
        <DatabaseTable dbId={pageId} />
      </div>
      {iconPicker && (
        <EmojiPicker
          anchor={iconPicker}
          allowRemove
          onClose={() => setIconPicker(null)}
          onPick={emoji => {
            setIcon(page.id, emoji)
            setIconPicker(null)
          }}
        />
      )}
    </div>
  )
}
