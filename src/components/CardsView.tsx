import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  ExternalLink,
  FileText,
  Layers,
  Plus,
  Repeat,
  Search,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { useClock } from '../store/clock'
import { dueAt, fmtInterval, retrievability, scheduleLabel } from '../lib/srs'
import { refText } from '../lib/refs'
import {
  historyVersion,
  readCardHistory,
  subscribeHistory,
} from '../lib/history'
import { cx, fmtRelative } from '../lib/util'
import type { CardType, SrsCard } from '../store/types'
import { CardForm, draftFromCard, emptyDraft, parseTags, type CardDraft } from './CardComposer'

const TYPE_ICON = { standard: Repeat, routine: CalendarClock, temp: Timer } as const

function dueLabel(card: SrsCard, now: number): string {
  if (card.archived) return 'archived'
  const due = dueAt(card, new Date(now))
  if (due === null) return 'archived'
  if (due <= now) return 'due now'
  return 'in ' + fmtInterval(due - now)
}

export function CardsView() {
  const cards = useSrsStore(s => s.cards)
  const pages = useStore(s => s.pages)
  const nowTick = useClock(s => s.nowTick)

  const [q, setQ] = useState('')
  const [deck, setDeck] = useState<'all' | 'unfiled' | string>('all')
  const [type, setType] = useState<'all' | CardType>('all')
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active')
  const [tag, setTag] = useState<'all' | string>('all')
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const all = useMemo(() => Object.values(cards), [cards])

  const decks = useMemo(() => {
    const ids = new Set(all.map(c => c.pageId).filter((x): x is string => !!x))
    return [...ids]
      .map(id => ({ id, title: pages[id]?.title || (pages[id] ? 'Untitled' : 'Deleted page') }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [all, pages])

  const tags = useMemo(() => [...new Set(all.flatMap(c => c.tags))].sort(), [all])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return all
      .filter(c => {
        if (status !== 'all' && (status === 'archived') !== c.archived) return false
        if (type !== 'all' && c.type !== type) return false
        if (deck === 'unfiled' ? c.pageId !== null : deck !== 'all' && c.pageId !== deck) return false
        if (tag !== 'all' && !c.tags.includes(tag)) return false
        if (query) {
          const hay = (c.front + ' ' + c.back + ' ' + c.tags.join(' ')).toLowerCase()
          if (!hay.includes(query)) return false
        }
        return true
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [all, q, deck, type, status, tag])

  return (
    <div className="view-scroll">
      <div className="cards-wrap">
        <div className="view-head">
          <h1 className="view-title">Cards</h1>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} strokeWidth={2.2} /> New card
          </button>
        </div>

        <div className="cards-toolbar">
          <div className="cards-search">
            <Search size={14} strokeWidth={1.9} />
            <input
              value={q}
              placeholder="Search cards…"
              onChange={e => setQ(e.target.value)}
              spellCheck={false}
            />
          </div>
          <select className="cf-mini cf-select" value={deck} onChange={e => setDeck(e.target.value)}>
            <option value="all">All decks</option>
            <option value="unfiled">Unfiled</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <select
            className="cf-mini cf-select"
            value={type}
            onChange={e => setType(e.target.value as typeof type)}
          >
            <option value="all">All types</option>
            <option value="standard">Spaced</option>
            <option value="routine">Routine</option>
            <option value="temp">Temporary</option>
          </select>
          <select
            className="cf-mini cf-select"
            value={status}
            onChange={e => setStatus(e.target.value as typeof status)}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          {tags.length > 0 && (
            <select className="cf-mini cf-select" value={tag} onChange={e => setTag(e.target.value)}>
              <option value="all">All tags</option>
              {tags.map(t => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="cards-empty">
            <Layers size={26} strokeWidth={1.4} />
            <div>No cards here yet.</div>
            <div className="cards-empty-sub">
              Select text in a page, right-click, and choose “New card” — or add one from scratch.
            </div>
          </div>
        ) : (
          <div className="cards-list">
            {filtered.map(card => {
              const TypeIcon = TYPE_ICON[card.type]
              const deckPage = card.pageId ? pages[card.pageId] : null
              const r = retrievability(card, new Date(nowTick))
              return (
                <button
                  key={card.id}
                  type="button"
                  className={cx('card-row', card.archived && 'is-archived')}
                  onClick={() => setEditing(card.id)}
                >
                  <span className={cx('type-chip', 'type-' + card.type)}>
                    <TypeIcon size={12} strokeWidth={1.9} />
                  </span>
                  <span className="card-row-main">
                    <span className="card-row-front">{card.front || 'Untitled card'}</span>
                    <span className="card-row-sub">
                      {card.back && <span className="card-row-back">{card.back}</span>}
                      {card.tags.map(t => (
                        <span key={t} className="tag-chip">
                          #{t}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="card-row-deck">
                    {card.pageId
                      ? deckPage
                        ? `${deckPage.icon ?? '📄'} ${deckPage.title || 'Untitled'}`
                        : 'Deleted page'
                      : 'Unfiled'}
                  </span>
                  <span className="card-row-r" title="Estimated recall right now">
                    {card.fsrs.reps > 0 ? Math.round(r * 100) + '%' : '—'}
                  </span>
                  <span className={cx('card-row-due', !card.archived && dueLabel(card, nowTick) === 'due now' && 'is-due')}>
                    {dueLabel(card, nowTick)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {editing && cards[editing] && (
        <CardEditModal id={editing} onClose={() => setEditing(null)} />
      )}
      {creating && <NewCardModal onClose={() => setCreating(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function NewCardModal({ onClose }: { onClose: () => void }) {
  const createCard = useSrsStore(s => s.createCard)
  const [draft, setDraft] = useState<CardDraft>(emptyDraft)
  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel modal-narrow">
        <div className="modal-head">
          <span className="modal-title">New card</span>
          <button type="button" className="icon-btn sm" onClick={onClose}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div className="modal-body">
          <CardForm draft={draft} onChange={setDraft} autoFocus />
        </div>
        <div className="modal-foot">
          <span className="composer-hint">Unfiled — not tied to any text</span>
          <div className="composer-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!draft.front.trim()}
              onClick={() => {
                createCard({
                  front: draft.front.trim(),
                  back: draft.back.trim(),
                  tags: parseTags(draft.tagsText),
                  pageId: null,
                  refs: [],
                  type: draft.type,
                  routine: draft.type === 'routine' ? draft.routine : undefined,
                  temp: draft.type === 'temp' ? draft.temp : undefined,
                })
                onClose()
              }}
            >
              Create card
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function CardEditModal({ id, onClose }: { id: string; onClose: () => void }) {
  const card = useSrsStore(s => s.cards[id])
  const updateCard = useSrsStore(s => s.updateCard)
  const toggleArchive = useSrsStore(s => s.toggleArchive)
  const deleteCard = useSrsStore(s => s.deleteCard)
  const pages = useStore(s => s.pages)
  const flashRefs = useStore(s => s.flashRefs)
  const nowTick = useClock(s => s.nowTick)

  const [draft, setDraft] = useState<CardDraft>(() => draftFromCard(card))
  const [confirming, setConfirming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const histVersion = useSyncExternalStore(subscribeHistory, historyVersion)
  const history = useMemo(
    () => readCardHistory(id).slice().reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, histVersion],
  )

  if (!card) return null
  const r = retrievability(card, new Date(nowTick))

  const save = () => {
    updateCard(id, {
      front: draft.front.trim(),
      back: draft.back.trim(),
      tags: parseTags(draft.tagsText),
      type: draft.type,
      routine: draft.type === 'routine' ? draft.routine : undefined,
      temp: draft.type === 'temp' ? draft.temp : undefined,
    })
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel modal-narrow">
        <div className="modal-head">
          <span className="modal-title">Edit card</span>
          <div className="modal-head-actions">
            <button
              type="button"
              className="pop-action"
              onClick={() => toggleArchive(id)}
              title={card.archived ? 'Bring back into rotation' : 'Keep forever, stop scheduling'}
            >
              {card.archived ? (
                <>
                  <ArchiveRestore size={12} strokeWidth={2} /> Unarchive
                </>
              ) : (
                <>
                  <Archive size={12} strokeWidth={2} /> Archive
                </>
              )}
            </button>
            <button type="button" className="icon-btn sm" onClick={onClose}>
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {card.archived && (
            <div className="card-archived-note">
              Archived {card.archivedAt ? fmtRelative(card.archivedAt) : ''} — kept forever, never
              scheduled. Its memory estimate keeps decaying below.
            </div>
          )}

          <CardForm draft={draft} onChange={setDraft} />

          <div className="card-stats">
            <span title="Estimated recall right now">
              knows&nbsp;<strong>{card.fsrs.reps > 0 ? Math.round(r * 100) + '%' : '—'}</strong>
            </span>
            <span>
              reps <strong>{card.fsrs.reps}</strong>
            </span>
            <span>
              lapses <strong>{card.fsrs.lapses}</strong>
            </span>
            <span title="FSRS memory stability, in days">
              stability <strong>{card.fsrs.stability.toFixed(1)}d</strong>
            </span>
            <span>
              created <strong>{fmtRelative(card.createdAt)}</strong>
            </span>
          </div>

          {card.refs.length > 0 && (
            <div className="edit-refs">
              <div className="cf-label">Highlights</div>
              {card.refs.map((ref, i) => {
                const { text, live } = refText(pages, card, ref)
                const refPage = pages[ref.pageId]
                return (
                  <div key={ref.refId} className="refs-item">
                    <div className="refs-quote">
                      <span className="refs-n">{i + 1}</span>
                      <span className="refs-text">{text}</span>
                    </div>
                    <div className="refs-src">
                      {!live && <span className="refs-stale">as highlighted — text has changed</span>}
                      <span className="refs-page">
                        {refPage ? `${refPage.icon ?? '📄'} ${refPage.title || 'Untitled'}` : 'Deleted page'}
                      </span>
                      {refPage && (
                        <button
                          type="button"
                          className="refs-open"
                          onClick={() => {
                            onClose()
                            flashRefs(card.id, ref.pageId)
                          }}
                        >
                          <ExternalLink size={11} strokeWidth={2} />
                          Open
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <button type="button" className="refs-toggle" onClick={() => setShowHistory(o => !o)}>
            <FileText size={12} strokeWidth={2} />
            History · {history.length}
          </button>
          {showHistory && (
            <div className="card-history">
              {history.map(v => (
                <div key={v.id} className="card-hist-row">
                  <span className={cx('hist-cause', 'cause-' + v.cause)}>{v.cause}</span>
                  <span className="card-hist-text">
                    <span className="card-hist-front">{v.front || '—'}</span>
                    {v.back && <span className="card-hist-back">{v.back}</span>}
                    <span className="card-hist-meta">
                      {v.type} · {v.schedule}
                      {v.tags.length > 0 && ' · ' + v.tags.map(t => '#' + t).join(' ')}
                    </span>
                  </span>
                  <span className="card-hist-ts">
                    {new Date(v.ts).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {confirming ? (
            <div className="confirm-inline">
              <span>Delete forever? Its history stays in the timeline.</span>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  deleteCard(id)
                  onClose()
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-ghost-danger" onClick={() => setConfirming(true)}>
                <Trash2 size={13} strokeWidth={1.9} /> Delete…
              </button>
              <div className="composer-actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!draft.front.trim()}
                  onClick={save}
                >
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
