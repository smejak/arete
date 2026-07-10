import { useMemo } from 'react'
import { PanelLeftClose, Plus, Search } from 'lucide-react'
import { useStore } from '../store/store'
import { childrenOf } from '../lib/tree'
import { PageTree, RootDropZone, TreeDndProvider } from './PageTree'

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

  const roots = useMemo(() => childrenOf(pages, null), [pages])
  const favs = useMemo(() => favorites.filter(id => pages[id]), [favorites, pages])

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
      </div>
    </aside>
  )
}
