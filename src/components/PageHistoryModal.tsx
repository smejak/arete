import { useMemo, useState, useSyncExternalStore } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import {
  ArrowRightLeft,
  Clock3,
  Keyboard,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { useStore } from '../store/store'
import { buildExtensions } from '../editor/extensions'
import {
  historyVersion,
  readPageHistory,
  subscribeHistory,
  type PageCause,
  type PageVersion,
} from '../lib/history'
import { cx } from '../lib/util'
import { localDay } from '../lib/srs'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

const CAUSE_META: Record<PageCause, { icon: typeof Keyboard; label: string }> = {
  create: { icon: Plus, label: 'created' },
  idle: { icon: Keyboard, label: 'typing paused' },
  card: { icon: Sparkles, label: 'card activity' },
  interval: { icon: Clock3, label: 'timed save' },
  switch: { icon: ArrowRightLeft, label: 'left page' },
  restore: { icon: RotateCcw, label: 'restored' },
  'pre-restore': { icon: ShieldCheck, label: 'before restore' },
}

function ReadonlyDoc({ content }: { content: JSONContent | null }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: content ?? EMPTY_DOC,
    editable: false,
  })
  return <EditorContent editor={editor} />
}

export function PageHistoryModal({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const restorePage = useStore(s => s.restorePage)
  const version = useSyncExternalStore(subscribeHistory, historyVersion)

  const versions = useMemo(
    () => readPageHistory(pageId).slice().reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageId, version],
  )
  const [selId, setSelId] = useState<string | null>(versions[0]?.id ?? null)
  const [confirming, setConfirming] = useState(false)
  const sel: PageVersion | undefined = versions.find(v => v.id === selId) ?? versions[0]

  const groups = useMemo(() => {
    const byDay = new Map<string, PageVersion[]>()
    for (const v of versions) {
      const d = localDay(v.ts)
      byDay.set(d, [...(byDay.get(d) ?? []), v])
    }
    return [...byDay.entries()]
  }, [versions])

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel modal-history">
        <div className="modal-head">
          <span className="modal-title">Page history</span>
          <button type="button" className="icon-btn sm" onClick={onClose}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>

        {versions.length === 0 ? (
          <div className="hist-empty">
            Versions appear when you pause typing, create cards, or every five minutes while editing.
          </div>
        ) : (
          <div className="hist-body">
            <div className="hist-list">
              {groups.map(([day, vs]) => (
                <div key={day}>
                  <div className="hist-day">
                    {new Date(day + 'T12:00:00').toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  {vs.map(v => {
                    const meta = CAUSE_META[v.cause]
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={cx('hist-row', sel?.id === v.id && 'is-active')}
                        onClick={() => {
                          setSelId(v.id)
                          setConfirming(false)
                        }}
                      >
                        <span className="hist-time">
                          {new Date(v.ts).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="hist-cause-icon" title={meta.label}>
                          <meta.icon size={12} strokeWidth={1.9} />
                        </span>
                        <span className="hist-row-label">{meta.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            <div className="hist-preview">
              {sel && (
                <>
                  <div className="hist-preview-scroll">
                    <div className="hist-preview-title">
                      {sel.icon && <span className="hist-preview-icon">{sel.icon}</span>}
                      {sel.title || 'Untitled'}
                    </div>
                    <div className="page font-sans hist-preview-doc">
                      <ReadonlyDoc key={sel.id} content={sel.content} />
                    </div>
                  </div>
                  <div className="hist-foot">
                    <span className="hist-foot-ts">
                      {new Date(sel.ts).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {confirming ? (
                      <div className="confirm-inline">
                        <span>Replace the current page with this version?</span>
                        <button type="button" className="btn" onClick={() => setConfirming(false)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            restorePage(pageId, sel)
                            onClose()
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn" onClick={() => setConfirming(true)}>
                        <RotateCcw size={13} strokeWidth={1.9} /> Restore this version
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
