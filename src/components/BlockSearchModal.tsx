import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Layers, Search } from 'lucide-react'
import { PageIcon } from '../lib/icon'
import { blockPick, useStore } from '../store/store'
import { blockText, searchBlocks, type BlockMatch } from '../lib/blocks'
import { blocksWithTag, colorOf, groupBlocks, kindOf, normalizeTag, tagUsage } from '../lib/tags'
import { cx } from '../lib/util'

type Mode = 'keywords' | 'tags'

/**
 * The block palette, with two ways in.
 *
 * **Keywords** finds a block by what it says. **Tags** finds it by what it was
 * filed under — and the two want different endings. Choosing a category drills
 * into its blocks and you pick one; choosing a group takes the whole thing,
 * because that is what a group is for. Anything else would either paste forty
 * paragraphs because someone once tagged them all, or make a deliberate set of
 * three no different from a filing label.
 */
export function BlockSearchModal() {
  const pages = useStore(s => s.pages)
  const registry = useStore(s => s.tagRegistry)
  const setBlockSearchOpen = useStore(s => s.setBlockSearchOpen)

  const [mode, setMode] = useState<Mode>('keywords')
  /** Set while browsing inside one category. */
  const [inTag, setInTag] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const usage = useMemo(() => tagUsage(pages), [pages])

  const keywordHits = useMemo(
    () => (mode === 'keywords' ? searchBlocks(pages, q) : []),
    [pages, q, mode],
  )

  const tagRows = useMemo(() => {
    if (mode !== 'tags' || inTag) return []
    const needle = normalizeTag(q)
    return [...usage.entries()]
      .filter(([name]) => !needle || name.includes(needle))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, n, kind: kindOf(registry, name) }))
  }, [mode, inTag, usage, q, registry])

  const tagBlocks = useMemo(() => {
    if (!inTag) return []
    const needle = q.trim().toLowerCase()
    return blocksWithTag(pages, inTag)
      .map(m => ({ ...m, text: blockText(m.node).trim() }))
      .filter(m => !needle || m.text.toLowerCase().includes(needle))
  }, [inTag, pages, q])

  const rowCount = mode === 'keywords' ? keywordHits.length : inTag ? tagBlocks.length : tagRows.length

  useEffect(() => setIndex(0), [q, mode, inTag])
  useEffect(() => inputRef.current?.focus(), [mode, inTag])
  useEffect(() => {
    listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const finish = (pick: Parameters<NonNullable<typeof blockPick.current>>[0]) => {
    const run = blockPick.current
    blockPick.current = null
    setBlockSearchOpen(false)
    run?.(pick)
  }

  const chooseBlock = (hit: BlockMatch | { pageId: string; index: number; node: BlockMatch['node']; text: string }) =>
    finish({ kind: 'block', hit: { pageId: hit.pageId, index: hit.index, node: hit.node, text: hit.text } })

  const chooseTag = (name: string) => {
    if (kindOf(registry, name) === 'group') {
      finish({ kind: 'group', tag: name })
      return
    }
    // A category is a way in, not a thing to take whole.
    setInTag(name)
    setQ('')
  }

  const activate = (i: number) => {
    if (mode === 'keywords') {
      const hit = keywordHits[i]
      if (hit) chooseBlock(hit)
    } else if (inTag) {
      const hit = tagBlocks[i]
      if (hit) chooseBlock(hit)
    } else {
      const row = tagRows[i]
      if (row) chooseTag(row.name)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (inTag) setInTag(null)
      else setBlockSearchOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(i => Math.min(i + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(index)
    } else if (e.key === 'Backspace' && !q && inTag) {
      e.preventDefault()
      setInTag(null)
    } else if (e.key === '#' && mode === 'keywords' && !q) {
      e.preventDefault()
      setMode('tags')
    }
  }

  const placeholder = inTag
    ? `Search inside #${inTag}…`
    : mode === 'tags'
      ? 'Find a tag or a group…'
      : 'Find a block by the words in it…'

  return createPortal(
    <div
      className="search-overlay"
      onMouseDown={e => e.target === e.currentTarget && setBlockSearchOpen(false)}
    >
      <div className="search-panel">
        <div className="search-input-row">
          {inTag ? (
            <button type="button" className="icon-btn sm" onClick={() => setInTag(null)} title="Back">
              <ChevronLeft size={16} strokeWidth={2} />
            </button>
          ) : (
            <Search size={17} strokeWidth={1.8} />
          )}
          <input
            ref={inputRef}
            className="search-input"
            value={q}
            placeholder={placeholder}
            spellCheck={false}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          {!inTag && (
            <span className="bpal-modes">
              {(['keywords', 'tags'] as Mode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  className={cx('bpal-mode', mode === m && 'is-on')}
                  onClick={() => {
                    setMode(m)
                    setQ('')
                  }}
                >
                  {m === 'keywords' ? 'Keywords' : 'Tags'}
                </button>
              ))}
            </span>
          )}
        </div>

        <div className="search-results" ref={listRef}>
          {mode === 'keywords' ? (
            !q.trim() ? (
              <div className="search-empty">
                Type the words you remember reading — or press <kbd className="kbd">#</kbd> to browse
                tags.
              </div>
            ) : keywordHits.length === 0 ? (
              <div className="search-empty">No block contains all of those words.</div>
            ) : (
              keywordHits.map((hit, i) => (
                <BlockRow
                  key={hit.pageId + ':' + hit.index}
                  parts={hit.parts}
                  pageId={hit.pageId}
                  selected={i === index}
                  onHover={() => index !== i && setIndex(i)}
                  onPick={() => chooseBlock(hit)}
                />
              ))
            )
          ) : inTag ? (
            tagBlocks.length === 0 ? (
              <div className="search-empty">Nothing under #{inTag} matches.</div>
            ) : (
              tagBlocks.map((hit, i) => (
                <BlockRow
                  key={hit.pageId + ':' + hit.index}
                  parts={[{ text: hit.text, hit: false }]}
                  pageId={hit.pageId}
                  selected={i === index}
                  onHover={() => index !== i && setIndex(i)}
                  onPick={() => chooseBlock(hit)}
                />
              ))
            )
          ) : tagRows.length === 0 ? (
            <div className="search-empty">No tags yet — add one from any block's handle.</div>
          ) : (
            tagRows.map((row, i) => (
              <button
                key={row.name}
                type="button"
                className="search-item bpal-tag"
                data-selected={i === index || undefined}
                onMouseMove={() => index !== i && setIndex(i)}
                onClick={() => chooseTag(row.name)}
              >
                <span className={cx('db-chip', 'dbo-' + colorOf(registry, row.name))}>{row.name}</span>
                {row.kind === 'group' && (
                  <span className="bpal-kind">
                    <Layers size={11} strokeWidth={2} /> group of{' '}
                    {groupBlocks(pages, row.name, registry.find(t => t.name === row.name)?.order).length}
                  </span>
                )}
                <span className="bpal-count">
                  {row.n} block{row.n === 1 ? '' : 's'}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="search-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="kbd">↵</kbd> {mode === 'tags' && !inTag ? 'open' : 'choose'}
          </span>
          <span>
            <kbd className="kbd">esc</kbd> {inTag ? 'back' : 'dismiss'}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function BlockRow({
  parts,
  pageId,
  selected,
  onHover,
  onPick,
}: {
  parts: { text: string; hit: boolean }[]
  pageId: string
  selected: boolean
  onHover: () => void
  onPick: () => void
}) {
  const page = useStore(s => s.pages[pageId])
  return (
    <button
      type="button"
      className="search-item block-item"
      data-selected={selected || undefined}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <span className="block-item-text">
        {parts.map((part, k) =>
          part.hit ? <mark key={k}>{part.text}</mark> : <span key={k}>{part.text}</span>,
        )}
      </span>
      <span className="block-item-src">
        <span className="search-item-icon">
          <PageIcon icon={page?.icon} size={13} strokeWidth={1.7} />
        </span>
        {page ? page.title || 'Untitled' : 'Unknown page'}
      </span>
    </button>
  )
}
