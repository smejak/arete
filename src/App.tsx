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
import { PagePeek } from './components/PagePeek'
import { DatabasePage } from './components/db/DatabasePage'
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

  const fontScale = useStore(s => s.fontScale)
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(fontScale || 1))
  }, [fontScale])

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
    void import('./lib/vault').then(v => v.initVault())
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

  // Pull the vault on window focus and on a slow poll, so activity another
  // device wrote to it (the optional iPhone app is one such writer, but this
  // covers any external change) surfaces here without a local edit. Both funnel
  // through the same guarded, debounced sync: it no-ops when no vault folder is
  // open and writes nothing when nothing changed — so a desktop-only setup is
  // completely unaffected.
  useEffect(() => {
    const pull = () => void import('./lib/vault').then(v => v.scheduleVaultSync())
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull()
    }
    window.addEventListener('focus', pull)
    document.addEventListener('visibilitychange', onVisible)
    const t = window.setInterval(pull, 60_000)
    return () => {
      window.removeEventListener('focus', pull)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(t)
    }
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
          {view === 'page' && page && page.db && <DatabasePage key={page.id} pageId={page.id} />}
          {view === 'page' && page && !page.db && (
            <PageView key={page.id + ':' + restoreNonce} pageId={page.id} />
          )}
          {view === 'review' && <ReviewView />}
          {view === 'cards' && <CardsView />}
          {view === 'insights' && <InsightsView />}
        </main>
      </div>
      {searchOpen && <SearchModal />}
      <PagePeek />
    </div>
  )
}
