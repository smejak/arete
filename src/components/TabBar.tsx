import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Layers,
  PanelLeftOpen,
  Plus,
  X,
} from 'lucide-react'
import { useStore, type Tab } from '../store/store'
import { cx } from '../lib/util'

const VIEW_META = {
  review: { icon: GraduationCap, label: 'Review' },
  cards: { icon: Layers, label: 'Cards' },
  insights: { icon: BarChart3, label: 'Insights' },
} as const

function TabChip({ tab, single }: { tab: Tab; single: boolean }) {
  const pages = useStore(s => s.pages)
  const isActive = useStore(s => s.activeTabId === tab.id)
  const activateTab = useStore(s => s.activateTab)
  const closeTab = useStore(s => s.closeTab)

  let icon: React.ReactNode
  let label: string
  if (tab.loc.view === 'page') {
    const page = tab.loc.pageId ? pages[tab.loc.pageId] : null
    icon = page?.icon ?? <FileText size={12} strokeWidth={1.8} />
    label = page ? page.title || 'Untitled' : 'Untitled'
  } else {
    const meta = VIEW_META[tab.loc.view]
    const Icon = meta.icon
    icon = <Icon size={12} strokeWidth={1.8} />
    label = meta.label
  }

  return (
    <div
      className={cx('tab', isActive && 'is-active')}
      role="tab"
      aria-selected={isActive}
      onClick={() => activateTab(tab.id)}
      onAuxClick={e => {
        if (e.button === 1 && !single) closeTab(tab.id)
      }}
      title={label}
    >
      <span className="tab-icon">{icon}</span>
      <span className="tab-title">{label}</span>
      {!single && (
        <button
          type="button"
          className="tab-x"
          aria-label="Close tab"
          onClick={e => {
            e.stopPropagation()
            closeTab(tab.id)
          }}
        >
          <X size={11} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

export function TabBar() {
  const tabs = useStore(s => s.tabs)
  const activeTabId = useStore(s => s.activeTabId)
  const goBack = useStore(s => s.goBack)
  const goForward = useStore(s => s.goForward)
  const newTab = useStore(s => s.newTab)
  const sidebarOpen = useStore(s => s.sidebarOpen)
  const toggleSidebar = useStore(s => s.toggleSidebar)

  const active = tabs.find(t => t.id === activeTabId)

  return (
    <div className="tabbar" data-tauri-drag-region="">
      {!sidebarOpen && (
        <button type="button" className="icon-btn" onClick={toggleSidebar} title="Open sidebar (⌘\)">
          <PanelLeftOpen size={16} strokeWidth={1.7} />
        </button>
      )}
      <div className="tab-nav">
        <button
          type="button"
          className="icon-btn"
          disabled={!active?.back.length}
          onClick={goBack}
          title="Back (⌥⌘←)"
        >
          <ChevronLeft size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={!active?.forward.length}
          onClick={goForward}
          title="Forward (⌥⌘→)"
        >
          <ChevronRight size={17} strokeWidth={1.8} />
        </button>
      </div>
      <div className="tabbar-tabs" role="tablist" data-tauri-drag-region="">
        {tabs.map(tab => (
          <TabChip key={tab.id} tab={tab} single={tabs.length === 1} />
        ))}
        <button type="button" className="icon-btn sm tab-new" onClick={() => newTab()} title="New tab">
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
