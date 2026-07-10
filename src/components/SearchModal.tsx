import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Search } from 'lucide-react'
import { pagePick, useStore } from '../store/store'
import { ancestorsOf, extractText } from '../lib/tree'
import type { Page } from '../store/types'

export function SearchModal() {
  const pages = useStore(s => s.pages)
  const setSearchOpen = useStore(s => s.setSearchOpen)
  const openPage = useStore(s => s.openPage)
  // Read once on mount: is this palette navigating, or picking a page to link?
  const picking = useRef(!!pagePick.current).current
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const all = Object.values(pages)
    const query = q.trim().toLowerCase()
    if (!query) return [...all].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8)
    return all
      .map(p => {
        const title = (p.title || 'Untitled').toLowerCase()
        let s = 0
        if (title.startsWith(query)) s += 60
        else if (title.includes(query)) s += 40
        if (extractText(p.content).toLowerCase().includes(query)) s += 12
        return { p, s }
      })
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || b.p.updatedAt - a.p.updatedAt)
      .map(x => x.p)
      .slice(0, 9)
  }, [pages, q])

  useEffect(() => setIndex(0), [q])
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = (page: Page) => {
    const pick = pagePick.current
    pagePick.current = null
    setSearchOpen(false)
    if (pick) pick(page.id)
    else openPage(page.id)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const p = results[index]
      if (p) choose(p)
    }
  }

  return createPortal(
    <div
      className="search-overlay"
      onMouseDown={e => {
        if (e.target === e.currentTarget) setSearchOpen(false)
      }}
    >
      <div className="search-panel">
        <div className="search-input-row">
          <Search size={17} strokeWidth={1.8} />
          <input
            ref={inputRef}
            className="search-input"
            value={q}
            placeholder={picking ? 'Link to a page…' : 'Search pages…'}
            spellCheck={false}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          {picking && <span className="search-mode">Link</span>}
        </div>
        <div className="search-results" ref={listRef}>
          {results.length === 0 ? (
            <div className="search-empty">No pages match “{q.trim()}”.</div>
          ) : (
            <>
              <div className="search-section">{q.trim() ? 'Results' : 'Recent'}</div>
              {results.map((p, i) => {
                const path = ancestorsOf(pages, p.id)
                  .map(a => a.title || 'Untitled')
                  .join(' / ')
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="search-item"
                    data-selected={i === index || undefined}
                    onMouseMove={() => index !== i && setIndex(i)}
                    onClick={() => choose(p)}
                  >
                    <span className="search-item-icon">
                      {p.icon ?? <FileText size={15} strokeWidth={1.7} />}
                    </span>
                    <span className="search-item-text">
                      <span className="search-item-title">{p.title || 'Untitled'}</span>
                      {path && <span className="search-item-path">{path}</span>}
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>
        <div className="search-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="kbd">↵</kbd> {picking ? 'link' : 'open'}
          </span>
          <span>
            <kbd className="kbd">esc</kbd> dismiss
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
