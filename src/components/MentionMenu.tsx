import { createPortal } from 'react-dom'
import { FileText, Plus } from 'lucide-react'
import type { MentionEntry } from '../editor/MentionCommand'
import { useStore } from '../store/store'
import { ancestorsOf } from '../lib/tree'
import { useMenuPosition, type SuggestView } from './SlashMenu'

export function MentionMenu({ view }: { view: SuggestView<MentionEntry> }) {
  const pages = useStore(s => s.pages)
  const { ref, style } = useMenuPosition(view)

  return createPortal(
    <div ref={ref} className="popover mention-menu" style={style}>
      {view.items.map((entry, i) => {
        const rowProps = {
          type: 'button' as const,
          className: 'mention-item',
          'data-selected': i === view.index || undefined,
          onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
          onMouseMove: () => view.index !== i && view.setIndex(i),
          onClick: () => view.execute(i),
        }
        if (entry.type === 'create') {
          return (
            <button key={entry.id} {...rowProps}>
              <span className="mention-icon">
                <Plus size={15} strokeWidth={1.8} />
              </span>
              <span className="mention-text">
                <span className="mention-title">Create “{entry.title}”</span>
                <span className="mention-path">New subpage of this page</span>
              </span>
            </button>
          )
        }
        const path = ancestorsOf(pages, entry.page.id)
          .map(a => a.title || 'Untitled')
          .join(' / ')
        return (
          <button key={entry.id} {...rowProps}>
            <span className="mention-icon">
              {entry.page.icon ?? <FileText size={15} strokeWidth={1.7} />}
            </span>
            <span className="mention-text">
              <span className="mention-title">{entry.page.title || 'Untitled'}</span>
              {path && <span className="mention-path">{path}</span>}
            </span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
