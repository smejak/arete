import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  Archive,
  ArchiveRestore,
  FilePlus2,
  FileText,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { useClock } from '../store/clock'
import { dueAt, localDay, retrievability, startOfDay } from '../lib/srs'
import {
  historyVersion,
  readEvents,
  subscribeHistory,
  type KbEvent,
  type KbEventKind,
} from '../lib/history'
import { cx, stripMd } from '../lib/util'

const DAY_MS = 86_400_000

export function InsightsView() {
  const [tab, setTab] = useState<'overview' | 'timeline'>('overview')
  return (
    <div className="view-scroll">
      <div className="insights-wrap">
        <div className="view-head">
          <h1 className="view-title">Insights</h1>
          <div className="cf-seg">
            <button
              type="button"
              className={cx('cf-seg-btn', tab === 'overview' && 'is-active')}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={cx('cf-seg-btn', tab === 'timeline' && 'is-active')}
              onClick={() => setTab('timeline')}
            >
              Timeline
            </button>
          </div>
        </div>
        {tab === 'overview' ? <Overview /> : <Timeline />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview() {
  const cards = useSrsStore(s => s.cards)
  const logs = useSrsStore(s => s.logs)
  const pages = useStore(s => s.pages)
  const nowTick = useClock(s => s.nowTick)

  const stats = useMemo(() => {
    const now = new Date(nowTick)
    const all = Object.values(cards)
    const active = all.filter(c => !c.archived)
    const studiedActive = active.filter(c => c.fsrs.reps > 0)
    const archivedStudied = all.filter(c => c.archived && c.fsrs.reps > 0)

    const byDay = new Map<string, { count: number; correct: number }>()
    for (const l of logs) {
      const d = localDay(l.ts)
      const e = byDay.get(d) ?? { count: 0, correct: 0 }
      e.count++
      if (l.rating > 1) e.correct++
      byDay.set(d, e)
    }

    const today = localDay(nowTick)
    const reviewedToday = byDay.get(today)?.count ?? 0

    // Streak: alive if today or yesterday has reviews; walk back from there.
    let streak = 0
    let cursor = startOfDay(now)
    if (!byDay.get(localDay(cursor))) cursor = new Date(cursor.getTime() - DAY_MS)
    while (byDay.get(localDay(cursor))) {
      streak++
      cursor = new Date(cursor.getTime() - DAY_MS)
    }

    const due = active.filter(c => {
      const d = dueAt(c, now)
      return d !== null && d <= now.getTime()
    }).length

    const avgR = (xs: typeof all) =>
      xs.length ? xs.reduce((a, c) => a + retrievability(c, now), 0) / xs.length : 0

    // by page
    const perPage = new Map<string, number>()
    for (const l of logs) perPage.set(l.pageId ?? '∅', (perPage.get(l.pageId ?? '∅') ?? 0) + 1)
    const byPage = [...perPage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([pid, count]) => ({
        label:
          pid === '∅'
            ? 'Unfiled'
            : pages[pid]
              ? `${pages[pid].icon ?? '📄'} ${pages[pid].title || 'Untitled'}`
              : '(deleted page)',
        count,
      }))

    // toughest
    const toughest = active
      .filter(c => c.fsrs.reps >= 2)
      .sort((a, b) => b.fsrs.lapses - a.fsrs.lapses || b.fsrs.difficulty - a.fsrs.difficulty)
      .slice(0, 6)
      .map(c => ({ id: c.id, front: stripMd(c.front), lapses: c.fsrs.lapses, r: retrievability(c, now) }))

    // slowest
    const times = new Map<string, number[]>()
    for (const l of logs) {
      if (l.elapsedMs > 0 && l.elapsedMs < 300_000) {
        times.set(l.cardId, [...(times.get(l.cardId) ?? []), l.elapsedMs])
      }
    }
    const slowest = [...times.entries()]
      .filter(([, xs]) => xs.length >= 2)
      .map(([id, xs]) => ({ id, avg: xs.reduce((a, b) => a + b, 0) / xs.length }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 6)
      .map(x => ({ ...x, front: cards[x.id] ? stripMd(cards[x.id].front) : '(deleted card)' }))
    const allTimes = [...times.values()].flat().sort((a, b) => a - b)
    const medianMs = allTimes.length ? allTimes[Math.floor(allTimes.length / 2)] : 0

    // time of day, 2h bins
    const bins = Array.from({ length: 12 }, () => ({ count: 0, correct: 0 }))
    for (const l of logs) {
      const b = bins[Math.floor(new Date(l.ts).getHours() / 2)]
      b.count++
      if (l.rating > 1) b.correct++
    }

    return {
      byDay,
      reviewedToday,
      streak,
      due,
      activeCount: active.length,
      retention: avgR(studiedActive),
      studiedCount: studiedActive.length,
      fadingCount: archivedStudied.length,
      fadingR: avgR(archivedStudied),
      byPage,
      toughest,
      slowest,
      medianMs,
      bins,
      totalReviews: logs.length,
    }
  }, [cards, logs, pages, nowTick])

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="tile-n">{stats.due}</div>
          <div className="tile-label">due now</div>
        </div>
        <div className="tile">
          <div className="tile-n">{stats.reviewedToday}</div>
          <div className="tile-label">reviewed today</div>
        </div>
        <div className="tile">
          <div className="tile-n">{stats.streak}</div>
          <div className="tile-label">day streak</div>
        </div>
        <div className="tile">
          <div className="tile-n">{stats.activeCount}</div>
          <div className="tile-label">active cards</div>
        </div>
        <div className="tile">
          <div className="tile-n">{stats.studiedCount ? Math.round(stats.retention * 100) + '%' : '—'}</div>
          <div className="tile-label">est. retention</div>
        </div>
        <div className="tile">
          <div className="tile-n">{stats.fadingCount ? Math.round(stats.fadingR * 100) + '%' : '—'}</div>
          <div className="tile-label">
            fading · {stats.fadingCount} archived
          </div>
        </div>
      </div>

      <Heatmap byDay={stats.byDay} />

      {stats.totalReviews === 0 ? (
        <div className="cards-empty">
          <Sparkles size={24} strokeWidth={1.4} />
          <div>No reviews yet.</div>
          <div className="cards-empty-sub">Create cards from your pages and run your first review — charts appear as you go.</div>
        </div>
      ) : (
        <div className="insight-grid">
          <section className="panel">
            <h2 className="panel-title">Most practiced pages</h2>
            {stats.byPage.map(row => {
              const max = stats.byPage[0]?.count || 1
              return (
                <div key={row.label} className="hbar-row" title={`${row.label} — ${row.count} reviews`}>
                  <span className="hbar-label">{row.label}</span>
                  <span className="hbar-track">
                    <span className="hbar-fill" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
                  </span>
                  <span className="hbar-n">{row.count}</span>
                </div>
              )
            })}
          </section>

          <section className="panel">
            <h2 className="panel-title">When you review</h2>
            <div className="tod">
              {stats.bins.map((b, i) => {
                const max = Math.max(...stats.bins.map(x => x.count), 1)
                const acc = b.count ? Math.round((b.correct / b.count) * 100) : null
                return (
                  <div
                    key={i}
                    className="tod-col"
                    title={`${i * 2}:00–${i * 2 + 2}:00 · ${b.count} review${b.count === 1 ? '' : 's'}${acc !== null ? ` · ${acc}% correct` : ''}`}
                  >
                    <span className="tod-acc">{b.count >= 5 ? acc + '%' : ''}</span>
                    <span className="tod-bar" style={{ height: `${(b.count / max) * 46}px` }} />
                    <span className="tod-h">{i % 2 === 0 ? i * 2 : ''}</span>
                  </div>
                )
              })}
            </div>
            <div className="panel-note">median answer time {(stats.medianMs / 1000).toFixed(1)}s</div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Toughest cards</h2>
            {stats.toughest.length === 0 && <div className="panel-note">Nothing tough yet.</div>}
            {stats.toughest.map(c => (
              <div key={c.id} className="mini-row" title={c.front}>
                <span className="mini-front">{c.front}</span>
                <span className="mini-meta">
                  {c.lapses} lapse{c.lapses === 1 ? '' : 's'} · {Math.round(c.r * 100)}%
                </span>
              </div>
            ))}
          </section>

          <section className="panel">
            <h2 className="panel-title">Slowest answers</h2>
            {stats.slowest.length === 0 && <div className="panel-note">Not enough data yet.</div>}
            {stats.slowest.map(c => (
              <div key={c.id} className="mini-row" title={c.front}>
                <span className="mini-front">{c.front}</span>
                <span className="mini-meta">{(c.avg / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </section>
        </div>
      )}

      <div className="insight-footnote">
        Retention is each card's live FSRS recall estimate — it keeps decaying after a card is
        archived. Cramming (temporary cards) lifts recall now but builds little lasting stability;
        spaced reviews are what make it stick.
      </div>
    </>
  )
}

function Heatmap({ byDay }: { byDay: Map<string, { count: number; correct: number }> }) {
  const { weeks, monthLabels, total } = useMemo(() => {
    const today = startOfDay(new Date())
    const start = new Date(today)
    start.setDate(start.getDate() - start.getDay() - 25 * 7) // Sunday, 26 columns
    const weeks: { day: Date; count: number }[][] = []
    let total = 0
    const cursor = new Date(start)
    for (let w = 0; w < 26; w++) {
      const col: { day: Date; count: number }[] = []
      for (let d = 0; d < 7; d++) {
        const count = cursor <= today ? (byDay.get(localDay(cursor))?.count ?? 0) : -1
        if (count > 0) total += count
        col.push({ day: new Date(cursor), count })
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(col)
    }
    const monthLabels = weeks.map((col, i) => {
      const first = col[0].day
      const prev = weeks[i - 1]?.[0].day
      return !prev || prev.getMonth() !== first.getMonth()
        ? first.toLocaleDateString(undefined, { month: 'short' })
        : ''
    })
    return { weeks, monthLabels, total }
  }, [byDay])

  const level = (count: number) =>
    count <= 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 11 ? 3 : 4

  return (
    <section className="panel heat-panel">
      <h2 className="panel-title">
        Practice · last 6 months <span className="panel-title-n">{total} reviews</span>
      </h2>
      <div className="heat">
        <div className="heat-days">
          <span />
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
        </div>
        <div>
          <div className="heat-months">
            {monthLabels.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          <div className="heat-grid">
            {weeks.map((col, wi) => (
              <div key={wi} className="heat-col">
                {col.map((cell, di) => (
                  <span
                    key={di}
                    className={cx('heat-cell', cell.count < 0 ? 'is-future' : 'l' + level(cell.count))}
                    title={
                      cell.count >= 0
                        ? `${cell.day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${cell.count} review${cell.count === 1 ? '' : 's'}`
                        : undefined
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="heat-legend">
        less
        {[0, 1, 2, 3, 4].map(l => (
          <span key={l} className={cx('heat-cell', 'l' + l)} />
        ))}
        more
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const EVENT_ICON: Record<KbEventKind, typeof FileText> = {
  'page-save': FileText,
  'page-create': FilePlus2,
  'page-delete': Trash2,
  'page-restore': RotateCcw,
  'card-create': Sparkles,
  'card-edit': Pencil,
  'card-archive': Archive,
  'card-unarchive': ArchiveRestore,
  'card-delete': Trash2,
}

const EVENT_VERB: Record<KbEventKind, string> = {
  'page-save': 'edited',
  'page-create': 'created',
  'page-delete': 'deleted',
  'page-restore': 'restored',
  'card-create': 'card created',
  'card-edit': 'card edited',
  'card-archive': 'card archived',
  'card-unarchive': 'card unarchived',
  'card-delete': 'card deleted',
}

function Timeline() {
  const version = useSyncExternalStore(subscribeHistory, historyVersion)
  const pages = useStore(s => s.pages)
  const openPage = useStore(s => s.openPage)

  const groups = useMemo(() => {
    const events = readEvents().slice().reverse()
    const byDay = new Map<string, KbEvent[]>()
    for (const e of events) {
      const d = localDay(e.ts)
      byDay.set(d, [...(byDay.get(d) ?? []), e])
    }
    return [...byDay.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  if (groups.length === 0) {
    return <div className="panel-note">The knowledge base timeline fills in as you write and study.</div>
  }

  return (
    <div className="timeline">
      {groups.map(([day, events]) => (
        <div key={day} className="tl-day">
          <div className="tl-day-label">
            {new Date(day + 'T12:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </div>
          {events.map(e => {
            const Icon = EVENT_ICON[e.kind]
            const isPage = e.kind.startsWith('page')
            const pageAlive = e.pageId && pages[e.pageId]
            return (
              <div key={e.id} className="tl-row">
                <span className={cx('tl-icon', 'tl-' + e.kind.split('-')[0])}>
                  <Icon size={13} strokeWidth={1.8} />
                </span>
                <span className="tl-text">
                  {isPage && pageAlive ? (
                    <button type="button" className="tl-link" onClick={() => openPage(e.pageId!)}>
                      {e.label}
                    </button>
                  ) : (
                    <span className="tl-label">{e.label}</span>
                  )}
                  <span className="tl-verb"> {EVENT_VERB[e.kind]}</span>
                  {!isPage && e.pageId && pages[e.pageId] && (
                    <>
                      <span className="tl-verb"> in </span>
                      <button type="button" className="tl-link" onClick={() => openPage(e.pageId!)}>
                        {pages[e.pageId].title || 'Untitled'}
                      </button>
                    </>
                  )}
                </span>
                <span className="tl-ts">
                  {new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
