import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsRight, Maximize2 } from 'lucide-react'
import { useStore } from '../store/store'
import { PageView } from './PageView'

/**
 * Notion-style side peek: a right-hand overlay hosting the full page editor
 * (title, database properties, blocks) while the surface behind stays put.
 * Table rows open here by default.
 */
export function PagePeek() {
  const peekId = useStore(s => s.peekPageId)
  const page = useStore(s => (s.peekPageId ? s.pages[s.peekPageId] : undefined))
  const setPeek = useStore(s => s.setPeek)
  const openPage = useStore(s => s.openPage)

  useEffect(() => {
    if (!peekId) return
    const onKey = (e: KeyboardEvent) => {
      // Menus and pickers eat Escape first (capture phase / preventDefault).
      if (e.key === 'Escape' && !e.defaultPrevented) setPeek(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [peekId, setPeek])

  if (!peekId || !page) return null

  return createPortal(
    <div className="peek-root">
      <div className="peek-catcher" onClick={() => setPeek(null)} />
      <aside className="peek-panel" role="dialog" aria-label={page.title || 'Untitled'}>
        <div className="peek-bar">
          <button
            type="button"
            className="icon-btn sm"
            title="Close (esc)"
            onClick={() => setPeek(null)}
          >
            <ChevronsRight size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            title="Open as full page"
            onClick={() => {
              setPeek(null)
              openPage(peekId)
            }}
          >
            <Maximize2 size={13.5} strokeWidth={1.8} />
          </button>
        </div>
        <div className="peek-body">
          <PageView key={'peek:' + peekId} pageId={peekId} />
        </div>
      </aside>
    </div>,
    document.body,
  )
}
