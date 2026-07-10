import { useMemo, useState } from 'react'
import { Check, FileDown, X } from 'lucide-react'
import { useStore } from '../store/store'
import { buildShareZip, saveZip, shareCounts, type ShareOptions } from '../lib/share'
import { cx } from '../lib/util'

export function ShareModal({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const page = useStore(s => s.pages[pageId])
  const [subpages, setSubpages] = useState(true)
  const [cards, setCards] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const counts = useMemo(
    () => shareCounts(pageId, { subpages, cards }),
    [pageId, subpages, cards],
  )

  if (!page) return null

  const download = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const zip = buildShareZip(pageId, { subpages, cards } satisfies ShareOptions)
      const saved = await saveZip(zip.filename, zip.data)
      if (saved) onClose()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel modal-narrow">
        <div className="modal-head">
          <span className="modal-title">Share “{page.title || 'Untitled'}”</span>
          <button type="button" className="icon-btn sm" onClick={onClose}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div className="modal-body">
          <div className="share-note">
            Exports plain markdown in a zip. Unzipped, it opens directly in Arete as a vault —
            pages, hierarchy{cards ? ', and cards' : ''} intact.
          </div>

          <button type="button" className="share-toggle" onClick={() => setSubpages(o => !o)}>
            <span className={cx('share-box', subpages && 'is-on')}>
              {subpages && <Check size={12} strokeWidth={3} />}
            </span>
            <span className="share-toggle-text">
              <strong>Include subpages</strong>
              <span>Everything nested under this page</span>
            </span>
          </button>

          <button type="button" className="share-toggle" onClick={() => setCards(o => !o)}>
            <span className={cx('share-box', cards && 'is-on')}>
              {cards && <Check size={12} strokeWidth={3} />}
            </span>
            <span className="share-toggle-text">
              <strong>Include cards</strong>
              <span>Cards from these pages, and any card whose highlights point into them</span>
            </span>
          </button>

          {msg && <div className="vault-msg">{msg}</div>}
        </div>
        <div className="modal-foot">
          <span className="composer-hint">
            {counts.pages} page{counts.pages === 1 ? '' : 's'}
            {cards ? ` · ${counts.cards} card${counts.cards === 1 ? '' : 's'}` : ''}
          </span>
          <div className="composer-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={download}>
              <FileDown size={14} strokeWidth={2} /> Download zip
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
