import { useEffect } from 'react'
import { useStore } from './store/store'
import { childrenOf } from './lib/tree'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { PageView } from './components/PageView'
import { SearchModal } from './components/SearchModal'

export default function App() {
  const theme = useStore(s => s.theme)
  const sidebarOpen = useStore(s => s.sidebarOpen)
  const searchOpen = useStore(s => s.searchOpen)
  const pages = useStore(s => s.pages)
  const activePageId = useStore(s => s.activePageId)
  const openPage = useStore(s => s.openPage)
  const createPage = useStore(s => s.createPage)
  const toggleSidebar = useStore(s => s.toggleSidebar)
  const setSearchOpen = useStore(s => s.setSearchOpen)

  const page = activePageId ? pages[activePageId] ?? null : null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Self-heal: always have a page to show.
  useEffect(() => {
    if (!page) {
      const first = childrenOf(pages, null)[0]
      if (first) openPage(first.id)
      else createPage({})
    }
  }, [page, pages, openPage, createPage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(!useStore.getState().searchOpen)
      } else if (e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen, toggleSidebar])

  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <div className="sidebar-wrap">
        <Sidebar />
      </div>
      <main className="main">
        <Topbar page={page} />
        {page && <PageView key={page.id} pageId={page.id} />}
      </main>
      {searchOpen && <SearchModal />}
    </div>
  )
}
