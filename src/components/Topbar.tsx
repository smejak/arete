import { Fragment, useState } from 'react'
import {
  Copy,
  Moon,
  MoreHorizontal,
  PanelLeftOpen,
  Star,
  StarOff,
  Sun,
  Trash2,
} from 'lucide-react'
import { useStore } from '../store/store'
import type { FontKey, Page } from '../store/types'
import { ancestorsOf, descendantsOf, wordCount } from '../lib/tree'
import { cx, fmtRelative } from '../lib/util'
import { Menu, Popover } from './Popover'

const FONTS: { key: FontKey; label: string }[] = [
  { key: 'sans', label: 'Default' },
  { key: 'serif', label: 'Serif' },
  { key: 'mono', label: 'Mono' },
]

export function Topbar({ page }: { page: Page | null }) {
  const pages = useStore(s => s.pages)
  const sidebarOpen = useStore(s => s.sidebarOpen)
  const toggleSidebar = useStore(s => s.toggleSidebar)
  const theme = useStore(s => s.theme)
  const toggleTheme = useStore(s => s.toggleTheme)
  const openPage = useStore(s => s.openPage)
  const favorites = useStore(s => s.favorites)
  const setFont = useStore(s => s.setFont)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const duplicatePage = useStore(s => s.duplicatePage)
  const deletePage = useStore(s => s.deletePage)

  const [menuAt, setMenuAt] = useState<DOMRect | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [overflowAt, setOverflowAt] = useState<DOMRect | null>(null)

  const trail = page ? [...ancestorsOf(pages, page.id), page] : []
  const compress = trail.length > 3
  const visible = compress ? [trail[0], ...trail.slice(-2)] : trail
  const hidden = compress ? trail.slice(1, -2) : []

  const fav = page ? favorites.includes(page.id) : false
  const subCount = page ? descendantsOf(pages, page.id).length : 0

  const closeMenu = () => {
    setMenuAt(null)
    setConfirming(false)
  }

  return (
    <header className="topbar">
      <div className="topbar-side">
        {!sidebarOpen && (
          <button
            type="button"
            className="icon-btn"
            onClick={toggleSidebar}
            title="Open sidebar (⌘\)"
          >
            <PanelLeftOpen size={16} strokeWidth={1.7} />
          </button>
        )}
        <nav className="crumbs" aria-label="Breadcrumb">
          {visible.map((p, i) => (
            <Fragment key={p.id}>
              {i > 0 && <span className="crumb-sep">/</span>}
              {compress && i === 1 && (
                <>
                  <button
                    type="button"
                    className="crumb crumb-more"
                    onClick={e => setOverflowAt(e.currentTarget.getBoundingClientRect())}
                  >
                    …
                  </button>
                  <span className="crumb-sep">/</span>
                </>
              )}
              <button
                type="button"
                className={cx('crumb', p.id === page?.id && 'is-current')}
                onClick={() => openPage(p.id)}
              >
                {p.icon && <span className="crumb-icon">{p.icon}</span>}
                <span className="crumb-title">{p.title || 'Untitled'}</span>
              </button>
            </Fragment>
          ))}
        </nav>
      </div>

      <div className="topbar-side">
        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        >
          {theme === 'dark' ? (
            <Sun size={16} strokeWidth={1.7} />
          ) : (
            <Moon size={16} strokeWidth={1.7} />
          )}
        </button>
        {page && (
          <button
            type="button"
            className="icon-btn"
            onClick={e => setMenuAt(e.currentTarget.getBoundingClientRect())}
            title="Page options"
          >
            <MoreHorizontal size={16} strokeWidth={1.7} />
          </button>
        )}
      </div>

      {overflowAt && (
        <Popover anchor={overflowAt} onClose={() => setOverflowAt(null)}>
          <Menu
            entries={hidden.map(h => ({
              label: (h.icon ? h.icon + '  ' : '') + (h.title || 'Untitled'),
              onSelect: () => {
                setOverflowAt(null)
                openPage(h.id)
              },
            }))}
          />
        </Popover>
      )}

      {menuAt && page && (
        <Popover anchor={menuAt} onClose={closeMenu} align="end" className="page-menu">
          {confirming ? (
            <div className="confirm">
              <div className="confirm-title">Delete “{page.title || 'Untitled'}”?</div>
              <div className="confirm-msg">
                {subCount > 0
                  ? `Its ${subCount} subpage${subCount === 1 ? '' : 's'} go with it. `
                  : ''}
                This can’t be undone.
              </div>
              <div className="confirm-actions">
                <button type="button" className="btn" onClick={closeMenu}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    closeMenu()
                    deletePage(page.id)
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="menu-note">Typeface</div>
              <div className="font-row">
                {FONTS.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    className={cx('font-card', page.font === f.key && 'is-active')}
                    onClick={() => setFont(page.id, f.key)}
                  >
                    <span className={'font-sample sample-' + f.key}>Ag</span>
                    <span className="font-name">{f.label}</span>
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
              <Menu
                entries={[
                  {
                    icon: fav ? StarOff : Star,
                    label: fav ? 'Remove from favorites' : 'Add to favorites',
                    onSelect: () => {
                      toggleFavorite(page.id)
                      closeMenu()
                    },
                  },
                  {
                    icon: Copy,
                    label: 'Duplicate',
                    onSelect: () => {
                      closeMenu()
                      duplicatePage(page.id)
                    },
                  },
                  { kind: 'sep' },
                  {
                    icon: Trash2,
                    label: 'Delete page…',
                    danger: true,
                    onSelect: () => setConfirming(true),
                  },
                ]}
              />
              <div className="menu-sep" />
              <div className="menu-note">
                {wordCount(page.content)} words · edited {fmtRelative(page.updatedAt)}
              </div>
            </>
          )}
        </Popover>
      )}
    </header>
  )
}
