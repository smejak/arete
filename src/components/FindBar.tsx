import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { findKey, findMatches, type FindRange } from '../editor/FindHighlight'
import { cx } from '../lib/util'

/** The last query survives close/reopen, browser-style. */
let lastQuery = ''

/** Open every collapsed toggle above the match, then center it on screen. */
function revealMatch(editor: Editor, match: FindRange) {
  const { state, view } = editor
  const $from = state.doc.resolve(match.from)
  const tr = state.tr
  let opened = false
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'toggle' && !node.attrs.open) {
      tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, open: true })
      opened = true
    }
  }
  if (opened) view.dispatch(tr)
  // The decoration paints on the next frame; scroll once it exists.
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return
    editor.view.dom.querySelector('.find-hit.is-current')?.scrollIntoView({ block: 'center' })
  })
}

export function FindBar({
  editor,
  seed,
  nonce,
  onClose,
}: {
  editor: Editor
  /** Selection captured at ⌘F time; empty keeps the previous query. */
  seed: string
  /** Bumped on every ⌘F so an already-open bar refocuses and reselects. */
  nonce: number
  onClose: () => void
}) {
  const [query, setQuery] = useState(() => seed || lastQuery)
  const [active, setActive] = useState(0)
  const [count, setCount] = useState(0)
  const [docTick, setDocTick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const matchesRef = useRef<FindRange[]>([])
  const activeRef = useRef(0)
  const computedForRef = useRef<string | null>(null)
  const scrolledRef = useRef('')

  useEffect(() => {
    if (seed) setQuery(seed)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [seed, nonce])

  // Recompute after every doc change while the bar is open, so the wash
  // tracks edits instead of drifting on stale positions.
  useEffect(() => {
    const bump = () => setDocTick(t => t + 1)
    editor.on('update', bump)
    return () => {
      editor.off('update', bump)
    }
  }, [editor])

  useEffect(() => {
    if (editor.isDestroyed) return
    lastQuery = query
    const matches = findMatches(editor.state.doc, query)
    matchesRef.current = matches
    let next = active
    if (computedForRef.current !== query) {
      computedForRef.current = query
      // A fresh query starts at the first match at or past the caret.
      const ahead = matches.findIndex(m => m.from >= editor.state.selection.from)
      next = ahead === -1 ? 0 : ahead
    }
    next = matches.length ? Math.min(next, matches.length - 1) : 0
    activeRef.current = next
    setCount(matches.length)
    if (next !== active) setActive(next)
    editor.view.dispatch(
      editor.state.tr.setMeta(findKey, matches.length ? { ranges: matches, active: next } : null),
    )
    // Scroll when the target changes — not when an edit merely recomputed it.
    const at = query + ':' + next
    if (matches.length && scrolledRef.current !== at) {
      scrolledRef.current = at
      revealMatch(editor, matches[next])
    }
  }, [editor, query, active, docTick])

  // Page navigation unmounts the bar directly — take the wash with it.
  useEffect(
    () => () => {
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta(findKey, null))
      }
    },
    [editor],
  )

  const step = (dir: 1 | -1) => {
    const n = matchesRef.current.length
    if (n) setActive(a => (a + dir + n) % n)
  }

  const close = (jump: boolean) => {
    if (!editor.isDestroyed) {
      const m = matchesRef.current[activeRef.current]
      let tr = editor.state.tr.setMeta(findKey, null)
      if (jump && m && m.to <= tr.doc.content.size) {
        tr = tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
        editor.view.dispatch(tr)
        // Synchronous focus, not editor.commands.focus() — TipTap defers that
        // to rAF and keystrokes arriving in the same frame would be lost.
        editor.view.focus()
      } else {
        editor.view.dispatch(tr)
      }
    }
    onClose()
  }

  // ⌘G / ⇧⌘G step matches from anywhere; Esc anywhere closes and drops the
  // caret on the current match. Capture phase: the same Esc must not also
  // dismiss the side peek hosting this page. Esc typed in the bar's own
  // input is left to the input handler below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape' && e.target !== inputRef.current) {
        e.preventDefault()
        close(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // step/close only touch refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    }
  }

  return createPortal(
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder="Find in page…"
        spellCheck={false}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={onInputKey}
      />
      <span className={cx('find-count', !!query.trim() && !count && 'is-none')}>
        {query.trim() ? (count ? `${active + 1} / ${count}` : '0 / 0') : ''}
      </span>
      <div className="find-sep" />
      <button
        type="button"
        className="icon-btn sm"
        title="Previous match (⇧↵)"
        disabled={!count}
        onMouseDown={e => e.preventDefault()}
        onClick={() => step(-1)}
      >
        <ChevronUp size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="icon-btn sm"
        title="Next match (↵)"
        disabled={!count}
        onMouseDown={e => e.preventDefault()}
        onClick={() => step(1)}
      >
        <ChevronDown size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="icon-btn sm"
        title="Done (esc)"
        onMouseDown={e => e.preventDefault()}
        onClick={() => close(true)}
      >
        <X size={14.5} strokeWidth={1.8} />
      </button>
    </div>,
    document.body,
  )
}
