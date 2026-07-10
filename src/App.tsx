import { useEffect } from 'react'
import { useStore } from './store/store'
import { useSrsStore } from './store/srs-store'
import { useClock } from './store/clock'
import { childrenOf } from './lib/tree'
import { cx } from './lib/util'
import { isTauriEnv } from './lib/fs-adapter'
import { recordPageVersion } from './lib/history'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { Topbar } from './components/Topbar'
import { PageView } from './components/PageView'
import { SearchModal } from './components/SearchModal'
import { ReviewView } from './components/ReviewView'
import { CardsView } from './components/CardsView'
import { InsightsView } from './components/InsightsView'

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
  const view = useStore(s => s.view)
  const restoreNonce = useStore(s => s.restoreNonce)

  const page = activePageId ? pages[activePageId] ?? null : null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Self-heal: always have a page to show, and at least one tab.
  useEffect(() => {
    if (!page) {
      const first = childrenOf(pages, null)[0]
      if (first) openPage(first.id)
      else createPage({})
    }
  }, [page, pages, openPage, createPage])

  useEffect(() => {
    useStore.getState().ensureTabs()
    void import('./lib/vault').then(v => v.tryRestoreVault())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(!useStore.getState().searchOpen)
      } else if (e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        // ⌥⌘← — ⌘[ belongs to the browser's own Back and can't be claimed
        e.preventDefault()
        useStore.getState().goBack()
      } else if (e.key === 'ArrowRight' && e.altKey) {
        e.preventDefault()
        useStore.getState().goForward()
      } else if (e.key.toLowerCase() === 't' && e.altKey) {
        e.preventDefault()
        useStore.getState().newTab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen, toggleSidebar])

  // Minute clock: refreshes due counts and auto-archives expired temp cards.
  useEffect(() => {
    const t = window.setInterval(() => {
      useClock.getState().tick()
      useSrsStore.getState().sweep()
    }, 60_000)
    return () => window.clearInterval(t)
  }, [])

  // Fixed-interval history saves (no-op guard keeps unchanged pages free).
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = useStore.getState()
      if (s.view === 'page' && s.activePageId) {
        const p = s.pages[s.activePageId]
        if (p) recordPageVersion(p, 'interval')
      }
    }, 300_000)
    return () => window.clearInterval(t)
  }, [])

  return (
    <div
      className={cx('app', isTauriEnv() && 'is-tauri')}
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
    >
      <TabBar />
      <div className="app-body">
        <div className="sidebar-wrap">
          <Sidebar />
        </div>
        <main className="main">
          <Topbar page={page} />
          {view === 'page' && page && (
            <PageView key={page.id + ':' + restoreNonce} pageId={page.id} />
          )}
          {view === 'review' && <ReviewView />}
          {view === 'cards' && <CardsView />}
          {view === 'insights' && <InsightsView />}
        </main>
      </div>
      {searchOpen && <SearchModal />}
    </div>
  )
}
