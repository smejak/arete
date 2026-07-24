import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { X } from 'lucide-react'
import { collectFootnotes } from '../editor/nodes/Footnote'
import { CardSide, CardTextEditor } from './CardTextEditor'
import { Popover } from './Popover'
import { cx } from '../lib/util'

interface Note {
  id: string
  md: string
  n: number
  /** Ideal top: its block's top, relative to .page. */
  top: number
}

/**
 * The margin to the right of a page: one small note per footnote, anchored
 * to the top of the block its number sits in, stacked apart when blocks
 * crowd. Click the number or the note to edit — the editor is the same
 * mini-Arete cards use, so markdown, "/" blocks, and KaTeX all work.
 * When there's no room for a margin (side peek, narrow windows), notes open
 * in a popover anchored to their number instead.
 */
export function FootnoteMargin({ editor }: { editor: Editor }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [narrow, setNarrow] = useState(false)
  const [noteWidth, setNoteWidth] = useState(200)
  const [editing, setEditing] = useState<string | null>(null)
  const [popAnchor, setPopAnchor] = useState<DOMRect | null>(null)
  const heights = useRef(new Map<string, number>())
  const els = useRef(new Map<string, HTMLDivElement>())
  const commitTimers = useRef(new Map<string, number>())
  const editingRef = useRef<string | null>(null)
  editingRef.current = editing

  const recompute = useCallback(() => {
    const view = editor.view
    const pageEl = view.dom.closest('.page') as HTMLElement | null
    const scroller = view.dom.closest('.page-scroll') as HTMLElement | null
    if (!pageEl || !scroller) return

    // Three layouts, best available: notes beside the centered page (as long
    // as the margin fits a usable note — the page stays centered); the page
    // leaning left (and narrowing a touch) when it truly doesn't; or — only
    // when even that fails (peek, tiny windows) — a popover.
    const GAP = 26
    const hasNotes = collectFootnotes(view.state.doc).length > 0
    const centeredRoom = (scroller.clientWidth - pageEl.offsetWidth) / 2 - GAP
    const lean = hasNotes && centeredRoom < 100
    pageEl.classList.toggle('fn-lean', lean)
    const pageRect = pageEl.getBoundingClientRect() // post-lean geometry
    const room = scroller.getBoundingClientRect().right - pageRect.right - GAP - 8
    setNarrow(room < 90)
    setNoteWidth(Math.max(90, Math.min(210, room)))
    const list: Note[] = []
    for (const fn of collectFootnotes(view.state.doc)) {
      const dom = view.nodeDOM(fn.pos)
      if (!(dom instanceof HTMLElement) || dom.offsetParent === null) continue // hidden (collapsed toggle)
      let block: HTMLElement = dom
      while (block.parentElement && block.parentElement !== view.dom) {
        block = block.parentElement
      }
      list.push({ id: fn.id, md: fn.md, n: fn.n, top: block.getBoundingClientRect().top - pageRect.top })
    }
    // Stack: keep document order, push a note below the previous one when
    // their blocks are closer than the notes are tall.
    let bottom = -Infinity
    for (const note of list) {
      if (note.top < bottom + 10) note.top = bottom + 10
      bottom = note.top + (heights.current.get(note.id) ?? 44)
    }
    setNotes(list)
  }, [editor])

  // Re-measure real heights after paint; re-stack if they changed enough.
  useLayoutEffect(() => {
    let dirty = false
    for (const [id, el] of els.current) {
      const h = el.offsetHeight
      if (Math.abs((heights.current.get(id) ?? 0) - h) > 1) {
        heights.current.set(id, h)
        dirty = true
      }
    }
    if (dirty) recompute()
  })

  useEffect(() => {
    recompute()
    const onTransaction = ({ transaction }: { transaction: { getMeta: (k: string) => unknown } }) => {
      const id = transaction.getMeta('footnoteCreated') as string | undefined
      if (id) {
        setEditing(id)
        // In narrow mode the popover needs its anchor — the freshly inserted ref.
        requestAnimationFrame(() => {
          const el = editor.view.dom.querySelector(`sup.fn-ref[data-id="${id}"]`)
          if (el) setPopAnchor(el.getBoundingClientRect())
        })
      }
    }
    editor.on('update', recompute)
    editor.on('transaction', onTransaction)
    window.addEventListener('resize', recompute)
    const ro = new ResizeObserver(recompute)
    ro.observe(editor.view.dom)
    // The editor column often keeps its capped width when the sidebar
    // toggles — the scroller is what actually resizes, so watch it too
    // (fires throughout the sidebar animation, settling the layout live).
    // TipTap re-parents view.dom after mount, so resolve the scroller with
    // retries instead of once (a detached dom has no .page-scroll ancestor).
    let tries = 0
    const hookScroller = () => {
      const scroller = editor.view.dom.closest('.page-scroll')
      if (scroller) ro.observe(scroller)
      else if (tries++ < 10) requestAnimationFrame(hookScroller)
    }
    hookScroller()
    return () => {
      editor.off('update', recompute)
      editor.off('transaction', onTransaction)
      window.removeEventListener('resize', recompute)
      ro.disconnect()
      if (!editor.isDestroyed) editor.view.dom.closest('.page')?.classList.remove('fn-lean')
    }
  }, [editor, recompute])

  // Numbers are clickable (the node's plugin broadcasts) and hoverable —
  // hovering a number lights up its note in the margin.
  const [hot, setHot] = useState<string | null>(null)
  useEffect(() => {
    const dom = editor.view.dom
    const onClick = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail
      if (!detail?.id) return
      setEditing(detail.id)
      const el = dom.querySelector(`sup.fn-ref[data-id="${detail.id}"]`)
      if (el) setPopAnchor(el.getBoundingClientRect())
    }
    const refOf = (e: Event) =>
      (e.target as HTMLElement | null)?.closest?.('sup.fn-ref') as HTMLElement | null
    const onOver = (e: Event) => {
      const sup = refOf(e)
      if (sup) setHot(sup.getAttribute('data-id'))
    }
    const onOut = (e: Event) => {
      if (refOf(e)) setHot(null)
    }
    dom.addEventListener('arete-footnote-click', onClick)
    dom.addEventListener('mouseover', onOver)
    dom.addEventListener('mouseout', onOut)
    return () => {
      dom.removeEventListener('arete-footnote-click', onClick)
      dom.removeEventListener('mouseover', onOver)
      dom.removeEventListener('mouseout', onOut)
    }
  }, [editor])

  const withNode = useCallback(
    (id: string, fn: (pos: number, attrs: Record<string, unknown>) => void) => {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'footnote' && node.attrs.id === id) {
          fn(pos, node.attrs)
          return false
        }
        return true
      })
    },
    [editor],
  )

  const commit = useCallback(
    (id: string, md: string) => {
      withNode(id, (pos, attrs) => {
        if (attrs.md === md) return
        const { state, view } = editor
        view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...attrs, md }))
      })
    },
    [editor, withNode],
  )

  const scheduleCommit = useCallback(
    (id: string, md: string) => {
      window.clearTimeout(commitTimers.current.get(id))
      commitTimers.current.set(
        id,
        window.setTimeout(() => commit(id, md), 400),
      )
    },
    [commit],
  )

  const remove = useCallback(
    (id: string) => {
      withNode(id, pos => {
        const { state, view } = editor
        view.dispatch(state.tr.delete(pos, pos + 1))
      })
      setEditing(null)
    },
    [editor, withNode],
  )

  const stopEditing = useCallback(() => setEditing(null), [])

  const editorFor = (note: Note) => (
    <CardTextEditor
      value={note.md}
      placeholder="Footnote…"
      autoFocus
      onChange={md => scheduleCommit(note.id, md)}
    />
  )

  if (narrow) {
    const note = notes.find(m => m.id === editing)
    return editing && note && popAnchor ? (
      <Popover anchor={popAnchor} onClose={stopEditing} className="fn-pop">
        <div className="fn-note is-editing is-floating" onKeyDown={e => e.key === 'Escape' && stopEditing()}>
          <div className="fn-note-head">
            <span className="fn-note-n">{note.n}</span>
            <button type="button" className="fn-note-x" title="Delete footnote" onClick={() => remove(note.id)}>
              <X size={12} strokeWidth={2.2} />
            </button>
          </div>
          {editorFor(note)}
        </div>
      </Popover>
    ) : null
  }

  return (
    <div className="fn-margin" style={{ width: noteWidth }} aria-label="Footnotes">
      {notes.map(note => (
        <div
          key={note.id}
          ref={el => {
            if (el) els.current.set(note.id, el)
            else els.current.delete(note.id)
          }}
          className={cx('fn-note', editing === note.id && 'is-editing', hot === note.id && 'is-hot')}
          style={{ top: note.top }}
          onClick={() => editing !== note.id && setEditing(note.id)}
          onKeyDown={e => e.key === 'Escape' && stopEditing()}
          onBlurCapture={e => {
            if (editingRef.current === note.id && !e.currentTarget.contains(e.relatedTarget as Node)) {
              stopEditing()
            }
          }}
        >
          <div className="fn-note-head">
            <span className="fn-note-n">{note.n}</span>
            {editing === note.id && (
              <button type="button" className="fn-note-x" title="Delete footnote" onClick={() => remove(note.id)}>
                <X size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>
          {editing === note.id ? (
            editorFor(note)
          ) : (
            <CardSide markdown={note.md || '*empty footnote*'} className="fn-note-body" />
          )}
        </div>
      ))}
    </div>
  )
}
