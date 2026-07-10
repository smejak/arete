import { useMemo } from 'react'
import { BarChart3, GraduationCap, Layers, PanelLeftClose, Plus, Search } from 'lucide-react'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { useClock } from '../store/clock'
import { isDue } from '../lib/srs'
import { childrenOf } from '../lib/tree'
import { cx } from '../lib/util'
import { PageTree, RootDropZone, TreeDndProvider } from './PageTree'
import { VaultButton } from './VaultPopover'

function RidgeMark() {
  return (
    <svg width="17" height="13" viewBox="0 0 24 18" fill="none" aria-hidden="true">
      <path
        d="M1.5 16.5 L9 4.5 L12.8 10.2 L16.5 4 L22.5 16.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="miter"
      />
    </svg>
  )
}

export function Sidebar() {
  const pages = useStore(s => s.pages)
  const favorites = useStore(s => s.favorites)
  const toggleSidebar = useStore(s => s.toggleSidebar)
  const setSearchOpen = useStore(s => s.setSearchOpen)
  const createPage = useStore(s => s.createPage)
  const view = useStore(s => s.view)
  const setView = useStore(s => s.setView)
  const nowTick = useClock(s => s.nowTick)
  const cards = useSrsStore(s => s.cards)

  const roots = useMemo(() => childrenOf(pages, null), [pages])
  const favs = useMemo(() => favorites.filter(id => pages[id]), [favorites, pages])

  const dueCount = useMemo(() => {
    const now = new Date(nowTick)
    return Object.values(cards).filter(c => isDue(c, now)).length
  }, [cards, nowTick])

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="wordmark">
          <RidgeMark />
          <span className="wordmark-name">Arete</span>
        </div>
        <button type="button" className="icon-btn" onClick={toggleSidebar} title="Close sidebar (⌘\)">
          <PanelLeftClose size={16} strokeWidth={1.7} />
        </button>
      </div>

      <button type="button" className="sidebar-search" onClick={() => setSearchOpen(true)}>
        <Search size={15} strokeWidth={1.8} />
        <span>Search</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      <nav className="sidebar-nav">
        <button
          type="button"
          className={cx('nav-row', view === 'review' && 'is-active')}
          onClick={() => setView('review')}
        >
          <GraduationCap size={15} strokeWidth={1.8} />
          <span>Review</span>
          {dueCount > 0 && <span className="due-badge">{dueCount}</span>}
        </button>
        <button
          type="button"
          className={cx('nav-row', view === 'cards' && 'is-active')}
          onClick={() => setView('cards')}
        >
          <Layers size={15} strokeWidth={1.8} />
          <span>Cards</span>
        </button>
        <button
          type="button"
          className={cx('nav-row', view === 'insights' && 'is-active')}
          onClick={() => setView('insights')}
        >
          <BarChart3 size={15} strokeWidth={1.8} />
          <span>Insights</span>
        </button>
      </nav>

      <TreeDndProvider>
        <div className="sidebar-scroll" role="tree">
          {favs.length > 0 && (
            <>
              <div className="section-label">Favorites</div>
              <PageTree ids={favs} section="fav" />
            </>
          )}
          <div className="section-label">Pages</div>
          <PageTree ids={roots.map(r => r.id)} section="main" draggable />
          <RootDropZone />
        </div>
      </TreeDndProvider>

      <div className="sidebar-foot">
        <button type="button" className="new-page" onClick={() => createPage({})}>
          <Plus size={16} strokeWidth={1.8} />
          <span>New page</span>
        </button>
        <VaultButton />
      </div>
    </aside>
  )
}
