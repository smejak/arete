import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useStore } from '../store/store'
import { buildExtensions } from '../editor/extensions'
import { readPageHistory, type PageVersion } from '../lib/history'
import { diffDocs } from '../lib/doc-diff'
import { diffDecorations, StepDiff, stepDiffKey, STEP_FLASH_MS } from '../editor/StepDiff'
import { PageIcon } from '../lib/icon'
import { COVERS } from '../lib/covers'
import { cx } from '../lib/util'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

const CAUSE_LABEL: Record<PageVersion['cause'], string> = {
  create: 'created',
  idle: 'typing paused',
  card: 'card activity',
  interval: 'timed save',
  switch: 'left page',
  restore: 'restored',
  'pre-restore': 'before restore',
}

const stamp = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/**
 * Reading a page backwards.
 *
 * The page is shown at a version, not diffed against one — so what is on
 * screen is simply how the page looked, and the only thing marked is the text
 * that arrived since wherever the reader just was. Deletions need no marking:
 * they are already gone from the version being shown.
 *
 * Nothing here writes. The live editor stays mounted underneath the whole
 * time, which is what makes cancelling free and instant — there is no state to
 * put back, because none was taken. Checking out is the one door out that
 * changes the page, and it goes through `restorePage` like any other restore,
 * appending rather than rewinding: history stays a list of things that
 * happened, which is the only reason stepping through it can be this simple.
 */
export function HistoryStepper() {
  const stepper = useStore(s => s.stepper)
  const closeStepper = useStore(s => s.closeStepper)
  const restorePage = useStore(s => s.restorePage)
  const pageId = stepper?.pageId ?? ''
  // Typeface and cover are the page's, not the version's — neither is
  // versioned, and both are the frame rather than the contents. Taking them
  // live is what keeps this looking like the page the reader was just on.
  const page = useStore(s => (pageId ? s.pages[pageId] : undefined))
  const cover = page?.cover ? COVERS[page.cover] : null

  // Read once per open. The list must not shift under the reader mid-step, and
  // checking out appends to it — re-reading would move the ground they are
  // standing on at the exact moment they act.
  const versions = useMemo(() => (pageId ? readPageHistory(pageId) : []), [pageId])

  const startAt = useMemo(() => {
    if (!versions.length) return 0
    const from = stepper?.versionId ? versions.findIndex(v => v.id === stepper.versionId) : -1
    return from >= 0 ? from : versions.length - 1
  }, [versions, stepper?.versionId])

  const [i, setI] = useState(startAt)
  const cameFrom = useRef<number | null>(null)

  const editor = useEditor(
    {
      extensions: [...buildExtensions(), StepDiff],
      content: versions[startAt]?.content ?? EMPTY_DOC,
      editable: false,
    },
    [pageId],
  )

  const at = versions[i]

  // Swap the document, then light what is new about it. Both have to happen
  // against the same doc, so the decorations are computed after setContent has
  // landed rather than from the version JSON.
  useEffect(() => {
    if (!editor || !at) return
    const from = cameFrom.current
    cameFrom.current = i
    editor.commands.setContent(at.content ?? EMPTY_DOC, false)
    if (from === null || from === i) return

    const decos = diffDecorations(editor.state.doc, diffDocs(versions[from]?.content, at.content))
    if (!decos.length) return
    editor.view.dispatch(editor.state.tr.setMeta(stepDiffKey, decos))
    const timer = window.setTimeout(() => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(stepDiffKey, null))
    }, STEP_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [editor, i, at, versions])

  const go = useCallback(
    (delta: number) => setI(prev => Math.min(versions.length - 1, Math.max(0, prev + delta))),
    [versions.length],
  )

  const checkout = useCallback(() => {
    const v = versions[i]
    if (v) restorePage(pageId, v)
    closeStepper()
  }, [versions, i, pageId, restorePage, closeStepper])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        closeStepper()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        checkout()
      }
    }
    // Capture: the live editor below is still mounted and would otherwise be a
    // plausible target for an arrow key.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, closeStepper, checkout])

  if (!stepper) return null

  return (
    <div className="stepper">
      <div className="stepbar-wrap">
        <div className="stepbar">
          <button type="button" className="stepbar-btn" onClick={closeStepper} title="Cancel (esc)">
            <X size={15} strokeWidth={2} />
          </button>
          <span className="stepbar-sep" />
          <button
            type="button"
            className="stepbar-btn"
            onClick={() => go(-1)}
            disabled={i <= 0}
            title="Older (←)"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <span className="stepbar-when">
            {at ? (
              <>
                <span className="stepbar-ts">{stamp(at.ts)}</span>
                <span className="stepbar-cause">{CAUSE_LABEL[at.cause]}</span>
              </>
            ) : (
              <span className="stepbar-ts">No history yet</span>
            )}
          </span>
          <button
            type="button"
            className="stepbar-btn"
            onClick={() => go(1)}
            disabled={i >= versions.length - 1}
            title="Newer (→)"
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
          <span className="stepbar-count">
            {versions.length ? `${i + 1}/${versions.length}` : '0'}
          </span>
          <span className="stepbar-sep" />
          <button
            type="button"
            className="stepbar-checkout"
            onClick={checkout}
            disabled={!at || i === versions.length - 1}
            title={
              i === versions.length - 1
                ? 'This is already the current version'
                : 'Make this the current version (enter)'
            }
          >
            <Check size={14} strokeWidth={2.2} /> Check out
          </button>
        </div>
      </div>

      <div className="stepper-scroll">
        {versions.length === 0 ? (
          <div className="stepper-empty">
            This page has no history yet. Versions appear when you pause typing, create cards, or
            every five minutes while editing.
          </div>
        ) : (
          <div className="stepper-page">
            {cover && <div className="page-cover" style={{ background: cover.css }} />}
            <div className={cx('page', 'font-' + (page?.font ?? 'sans'), cover && 'has-cover')}>
              <div className="page-head">
                {at?.icon && (
                  <div className="page-icon stepper-icon">
                    <PageIcon icon={at.icon} size={52} strokeWidth={1.5} />
                  </div>
                )}
                <div className="page-title stepper-title">{at?.title || 'Untitled'}</div>
              </div>
              <div className="editor-shell">
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
