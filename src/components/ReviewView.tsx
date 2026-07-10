import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  ExternalLink,
  FileText,
  GraduationCap,
  Quote,
  Repeat,
  Timer,
} from 'lucide-react'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { useClock } from '../store/clock'
import { dueAt, isDue, previewIntervals, scheduleLabel, localDay } from '../lib/srs'
import { refText } from '../lib/refs'
import { cx } from '../lib/util'
import type { SrsCard } from '../store/types'

const TYPE_ICON = { standard: Repeat, routine: CalendarClock, temp: Timer } as const
const TYPE_LABEL = { standard: 'Spaced', routine: 'Routine', temp: 'Temporary' } as const

const RATINGS: { r: 1 | 2 | 3 | 4; label: string; key: string; kind: 'again' | 'ok' }[] = [
  { r: 1, label: 'Again', key: '1', kind: 'again' },
  { r: 2, label: 'Hard', key: '2', kind: 'ok' },
  { r: 3, label: 'Good', key: '3', kind: 'ok' },
  { r: 4, label: 'Easy', key: '4', kind: 'ok' },
]

function fmtNextDue(ts: number): string {
  const d = new Date(ts)
  if (localDay(ts) === localDay(Date.now())) {
    return 'today at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function ReviewView() {
  const cards = useSrsStore(s => s.cards)
  const logs = useSrsStore(s => s.logs)
  const reviewCard = useSrsStore(s => s.reviewCard)
  const sweep = useSrsStore(s => s.sweep)
  const pages = useStore(s => s.pages)
  const nowTick = useClock(s => s.nowTick)
  const openPage = useStore(s => s.openPage)
  const flashRefs = useStore(s => s.flashRefs)
  const setView = useStore(s => s.setView)

  const [session, setSession] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [showRefs, setShowRefs] = useState(false)
  const shownAt = useRef(Date.now())

  useEffect(() => {
    sweep()
  }, [sweep])

  const queue = useMemo(() => {
    const now = new Date()
    return Object.values(cards)
      .filter(c => isDue(c, now))
      .sort((a, b) => (dueAt(a, now) ?? 0) - (dueAt(b, now) ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, nowTick, session])

  const current: SrsCard | undefined = queue[0]

  useEffect(() => {
    setRevealed(false)
    setShowRefs(false)
    shownAt.current = Date.now()
  }, [current?.id, session])

  const rate = (r: 1 | 2 | 3 | 4) => {
    if (!current) return
    reviewCard(current.id, r, Date.now() - shownAt.current)
    setSession(s => s + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!current) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed) {
        if (e.key === ' ') {
          e.preventDefault()
          rate(3)
        } else {
          const hit = RATINGS.find(x => x.key === e.key)
          if (hit) {
            e.preventDefault()
            rate(hit.r)
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, revealed, session])

  const reviewedToday = useMemo(() => {
    const today = localDay(Date.now())
    return logs.filter(l => localDay(l.ts) === today).length
  }, [logs])

  const intervals = useMemo(
    () => (current && current.type === 'standard' ? previewIntervals(current, new Date()) : null),
    [current],
  )

  const nextDue = useMemo(() => {
    const now = Date.now()
    let min: number | null = null
    for (const c of Object.values(cards)) {
      const d = dueAt(c, new Date(now))
      if (d !== null && d > now && (min === null || d < min)) min = d
    }
    return min
  }, [cards, nowTick, session]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) {
    return (
      <div className="view-scroll">
        <div className="review-wrap">
          <div className="review-empty">
            <GraduationCap size={28} strokeWidth={1.4} />
            <div className="review-empty-title">
              {session > 0 ? 'Session complete' : 'All clear'}
            </div>
            <div className="review-empty-sub">
              {session > 0 && <>You reviewed {session} card{session === 1 ? '' : 's'}. </>}
              {nextDue ? <>Next card {fmtNextDue(nextDue)}.</> : 'Highlight text in any page to make your first card.'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const TypeIcon = TYPE_ICON[current.type]
  const deck = current.pageId ? pages[current.pageId] : null
  const progress =
    current.type === 'temp' && current.temp
      ? `${current.day === localDay(Date.now()) ? current.daySlotsDone ?? 0 : 0}/${current.temp.perDay} today`
      : null

  return (
    <div className="view-scroll">
      <div className="review-wrap">
        <div className="review-meta">
          <span className="review-count">
            {queue.length} due · {reviewedToday} reviewed today
          </span>
        </div>

        <div className="review-card">
          <div className="review-card-top">
            <span className={cx('type-chip', 'type-' + current.type)}>
              <TypeIcon size={12} strokeWidth={1.9} />
              {TYPE_LABEL[current.type]}
            </span>
            <span className="review-schedule">{scheduleLabel(current)}</span>
            {progress && <span className="review-progress">{progress}</span>}
            {deck && (
              <button type="button" className="review-deck" onClick={() => openPage(deck.id)}>
                {deck.icon ?? <FileText size={12} strokeWidth={1.8} />}
                <span>{deck.title || 'Untitled'}</span>
              </button>
            )}
          </div>

          <div className="review-front">{current.front}</div>

          {revealed ? (
            <>
              <div className="review-divider" />
              <div className="review-back">{current.back || <span className="review-noback">—</span>}</div>
            </>
          ) : (
            <button type="button" className="review-reveal" onClick={() => setRevealed(true)}>
              Show answer <kbd className="kbd">space</kbd>
            </button>
          )}

          {current.refs.length > 0 && (
            <div className="review-refs">
              <button type="button" className="refs-toggle" onClick={() => setShowRefs(o => !o)}>
                <Quote size={12} strokeWidth={2} />
                Refs · {current.refs.length}
              </button>
              {showRefs && (
                <div className="refs-list">
                  {current.refs.map((ref, i) => {
                    const { text, live } = refText(pages, current, ref)
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
                              onClick={() => flashRefs(current.id, ref.pageId)}
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
            </div>
          )}
        </div>

        {revealed && (
          <div className="review-ratings">
            {RATINGS.map(({ r, label, key, kind }) => (
              <button
                key={r}
                type="button"
                className={cx('rate-btn', kind === 'again' ? 'rate-again' : 'rate-ok')}
                onClick={() => rate(r)}
              >
                <span className="rate-label">{label}</span>
                <span className="rate-sub">
                  {intervals
                    ? intervals[r]
                    : r === 1
                      ? 'retry'
                      : current.type === 'temp'
                        ? 'counts'
                        : 'done'}
                </span>
                <kbd className="kbd">{key}</kbd>
              </button>
            ))}
          </div>
        )}

        <div className="review-hint">
          {current.type === 'routine' && 'Routine cards return on their schedule — only correct answers advance it.'}
          {current.type === 'temp' &&
            current.temp &&
            `Cramming until ${new Date(current.temp.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, then this card archives itself.`}
          {current.type === 'standard' && 'Intervals grow with every correct answer.'}
        </div>

        <button type="button" className="review-browse" onClick={() => setView('cards')}>
          Browse all cards →
        </button>
      </div>
    </div>
  )
}
