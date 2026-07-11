import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import { useStore } from '../store/store'
import { childrenOf, descendantsOf, inSubtree } from '../lib/tree'
import { cx } from '../lib/util'
import type { Anchor } from '../lib/position'
import { Menu, Popover } from './Popover'

type Zone = 'before' | 'after' | 'inside'

interface DndState {
  dragId: string | null
  over: { key: string; zone: Zone } | null
  setDragId: (id: string | null) => void
  setOver: (o: { key: string; zone: Zone } | null) => void
}

const DndCtx = createContext<DndState | null>(null)

export function TreeDndProvider({ children }: { children: ReactNode }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ key: string; zone: Zone } | null>(null)
  const value = useMemo(() => ({ dragId, over, setDragId, setOver }), [dragId, over])
  return <DndCtx.Provider value={value}>{children}</DndCtx.Provider>
}

/** Set when a pointer drag just finished, so the row's click doesn't fire. */
let didJustDrag = false

/**
 * Pointer-based drag (HTML5 drag-and-drop never fires inside Tauri's
 * WKWebView): press, move past a threshold, hit-test rows under the pointer
 * for a before/after/inside zone, drop on release. A small ghost with the
 * page title follows the cursor.
 */
function startTreeDrag(
  e: React.PointerEvent,
  id: string,
  title: string,
  dnd: DndState,
  canDrop: (targetId: string) => boolean,
  onDrop: (target: { key: string; zone: Zone } | null) => void,
) {
  const startX = e.clientX
  const startY = e.clientY
  let dragging = false
  let ghost: HTMLDivElement | null = null
  let current: { key: string; zone: Zone } | null = null

  const hitTest = (x: number, y: number): { key: string; zone: Zone } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null
    const row = el.closest<HTMLElement>('[data-tree-id]')
    if (row?.dataset.treeId && row.dataset.treeDroppable === 'true') {
      const targetId = row.dataset.treeId
      if (targetId === id || !canDrop(targetId)) return null
      const r = row.getBoundingClientRect()
      const frac = (y - r.top) / r.height
      const zone: Zone = frac < 0.3 ? 'before' : frac > 0.7 ? 'after' : 'inside'
      return { key: targetId, zone }
    }
    if (el.closest('[data-tree-root]')) return { key: '__root__', zone: 'after' }
    return null
  }

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      dragging = true
      dnd.setDragId(id)
      document.body.classList.add('is-tree-dragging')
      ghost = document.createElement('div')
      ghost.className = 'tree-ghost'
      ghost.textContent = title
      document.body.appendChild(ghost)
    }
    if (ghost) {
      ghost.style.left = ev.clientX + 12 + 'px'
      ghost.style.top = ev.clientY + 10 + 'px'
    }
    const target = hitTest(ev.clientX, ev.clientY)
    current = target
    dnd.setOver(target)
  }

  const up = () => {
    window.removeEventListener('pointermove', move)
    document.body.classList.remove('is-tree-dragging')
    ghost?.remove()
    if (dragging) {
      didJustDrag = true
      window.setTimeout(() => {
        didJustDrag = false
      }, 0)
      onDrop(current)
    }
    dnd.setDragId(null)
    dnd.setOver(null)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}

export function PageTree({
  ids,
  section,
  depth = 0,
  draggable = false,
}: {
  ids: string[]
  section: 'main' | 'fav'
  depth?: number
  draggable?: boolean
}) {
  return (
    <>
      {ids.map(id => (
        <TreeItem key={id} id={id} section={section} depth={depth} draggable={draggable} />
      ))}
    </>
  )
}

/** Catch-all target below the tree: dropping here moves a page to root level. */
export function RootDropZone() {
  const dnd = useContext(DndCtx)
  const active = dnd?.dragId && dnd.over?.key === '__root__'
  return <div className={cx('tree-tail', active && 'is-drop')} data-tree-root="true" />
}

function TreeItem({
  id,
  section,
  depth,
  draggable,
}: {
  id: string
  section: 'main' | 'fav'
  depth: number
  draggable: boolean
}) {
  const pages = useStore(s => s.pages)
  const page = pages[id]
  const isActive = useStore(s => s.activePageId) === id
  const expandKey = section + ':' + id
  const expanded = useStore(s => !!s.expanded[expandKey])
  const toggleExpand = useStore(s => s.toggleExpand)
  const openPage = useStore(s => s.openPage)
  const createPage = useStore(s => s.createPage)
  const movePage = useStore(s => s.movePage)
  const dnd = useContext(DndCtx)
  const [menuAt, setMenuAt] = useState<Anchor | null>(null)

  const kids = useMemo(() => (page ? childrenOf(pages, id) : []), [pages, id, page])
  if (!page) return null

  const dropZone = draggable && dnd?.dragId && dnd.over?.key === id ? dnd.over.zone : null

  return (
    <>
      <div
        className={cx('tree-row', isActive && 'is-active', dropZone && 'drop-' + dropZone)}
        style={{ paddingLeft: 10 + depth * 14 }}
        role="treeitem"
        aria-expanded={expanded}
        data-tree-id={id}
        data-tree-droppable={draggable ? 'true' : undefined}
        onPointerDown={e => {
          if (!draggable || !dnd || e.button !== 0) return
          if ((e.target as HTMLElement).closest('button')) return
          const state = useStore.getState()
          startTreeDrag(
            e,
            id,
            page.title || 'Untitled',
            dnd,
            targetId => !inSubtree(state.pages, targetId, id),
            target => {
              if (!target) return
              if (target.key === '__root__') movePage(id, { type: 'root-end' })
              else movePage(id, { type: target.zone, id: target.key })
            },
          )
        }}
        onClick={e => {
          if (didJustDrag) return
          if (e.metaKey || e.ctrlKey) {
            useStore.getState().newTab({ view: 'page', pageId: id })
          } else {
            openPage(id)
          }
        }}
        onContextMenu={e => {
          e.preventDefault()
          setMenuAt({ x: e.clientX, y: e.clientY })
        }}
      >
        <span className="row-slot">
          <span className="row-icon">
            {page.icon ?? <FileText size={15} strokeWidth={1.7} />}
          </span>
          <button
            type="button"
            className="row-toggle"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={e => {
              e.stopPropagation()
              toggleExpand(expandKey)
            }}
          >
            <ChevronRight size={13} strokeWidth={2.4} className={cx(expanded && 'is-open')} />
          </button>
        </span>
        <span className="row-title">{page.title || 'Untitled'}</span>
        <span className="row-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="icon-btn sm"
            title="Rename, favorite, delete…"
            onClick={e => setMenuAt(e.currentTarget.getBoundingClientRect())}
          >
            <MoreHorizontal size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            title="Add a page inside"
            onClick={() => createPage({ parentId: id })}
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </span>
      </div>

      {menuAt && <TreeItemMenu id={id} anchor={menuAt} onClose={() => setMenuAt(null)} />}

      {expanded &&
        (kids.length > 0 ? (
          <PageTree
            ids={kids.map(k => k.id)}
            section={section}
            depth={depth + 1}
            draggable={draggable}
          />
        ) : (
          <div className="tree-empty" style={{ paddingLeft: 10 + (depth + 1) * 14 + 24 }}>
            No pages inside
          </div>
        ))}
    </>
  )
}

function TreeItemMenu({
  id,
  anchor,
  onClose,
}: {
  id: string
  anchor: Anchor
  onClose: () => void
}) {
  const pages = useStore(s => s.pages)
  const favorites = useStore(s => s.favorites)
  const openPage = useStore(s => s.openPage)
  const createPage = useStore(s => s.createPage)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const duplicatePage = useStore(s => s.duplicatePage)
  const deletePage = useStore(s => s.deletePage)
  const [confirming, setConfirming] = useState(false)

  const page = pages[id]
  if (!page) return null
  const fav = favorites.includes(id)
  const subCount = descendantsOf(pages, id).length

  return (
    <Popover anchor={anchor} onClose={onClose}>
      {confirming ? (
        <div className="confirm">
          <div className="confirm-title">Delete “{page.title || 'Untitled'}”?</div>
          <div className="confirm-msg">
            {subCount > 0 ? `Its ${subCount} subpage${subCount === 1 ? '' : 's'} go with it. ` : ''}
            This can’t be undone.
          </div>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                onClose()
                deletePage(id)
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <Menu
          entries={[
            {
              icon: ExternalLink,
              label: 'Open in new tab',
              onSelect: () => {
                onClose()
                useStore.getState().newTab({ view: 'page', pageId: id })
              },
            },
            {
              icon: FilePlus2,
              label: 'New subpage',
              onSelect: () => {
                onClose()
                createPage({ parentId: id })
              },
            },
            {
              icon: Pencil,
              label: 'Rename',
              onSelect: () => {
                onClose()
                openPage(id, { focusTitle: true })
              },
            },
            {
              icon: fav ? StarOff : Star,
              label: fav ? 'Remove from favorites' : 'Add to favorites',
              onSelect: () => {
                toggleFavorite(id)
                onClose()
              },
            },
            {
              icon: Copy,
              label: 'Duplicate',
              onSelect: () => {
                onClose()
                duplicatePage(id)
              },
            },
            { kind: 'sep' },
            {
              icon: Trash2,
              label: 'Delete…',
              danger: true,
              onSelect: () => setConfirming(true),
            },
          ]}
        />
      )}
    </Popover>
  )
}
