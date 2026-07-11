import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarClock,
  Highlighter,
  Maximize2,
  Minimize2,
  Plus,
  Repeat,
  Timer,
  X,
} from 'lucide-react'
import type { CardType, RoutineConfig, SrsCard, TempConfig } from '../store/types'
import { localDay } from '../lib/srs'
import { cx } from '../lib/util'
import { CardTextEditor } from './CardTextEditor'

// ---------------------------------------------------------------------------
// Draft model shared by the composer and the card editor
// ---------------------------------------------------------------------------

export interface CardDraft {
  front: string
  back: string
  tagsText: string
  type: CardType
  routine: RoutineConfig
  temp: TempConfig
}

export const defaultRoutine = (): RoutineConfig => ({
  every: 1,
  unit: 'day',
  mode: 'anytime',
  times: ['09:00'],
  count: 3,
  gapHours: 2,
})

export const defaultTemp = (): TempConfig => ({
  perDay: 5,
  gapMinutes: 30,
  until: Date.now() + 7 * 86_400_000,
})

export const emptyDraft = (): CardDraft => ({
  front: '',
  back: '',
  tagsText: '',
  type: 'standard',
  routine: defaultRoutine(),
  temp: defaultTemp(),
})

export const draftFromCard = (card: SrsCard): CardDraft => ({
  front: card.front,
  back: card.back,
  tagsText: card.tags.join(', '),
  type: card.type,
  routine: card.routine ?? defaultRoutine(),
  temp: card.temp ?? defaultTemp(),
})

export const parseTags = (text: string) =>
  Array.from(new Set(text.split(',').map(t => t.trim()).filter(Boolean)))

const TYPES: { key: CardType; label: string; icon: typeof Repeat; blurb: string }[] = [
  { key: 'standard', label: 'Spaced', icon: Repeat, blurb: 'Classic spaced repetition — intervals grow as you remember.' },
  { key: 'routine', label: 'Routine', icon: CalendarClock, blurb: 'Returns on a fixed rhythm, no matter how well you know it.' },
  { key: 'temp', label: 'Temporary', icon: Timer, blurb: 'Crams hard until a date, then archives itself.' },
]

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export function CardForm({
  draft,
  onChange,
  autoFocus = false,
}: {
  draft: CardDraft
  onChange: (next: CardDraft) => void
  autoFocus?: boolean
}) {
  const patch = (p: Partial<CardDraft>) => onChange({ ...draft, ...p })
  const patchRoutine = (p: Partial<RoutineConfig>) => patch({ routine: { ...draft.routine, ...p } })
  const patchTemp = (p: Partial<TempConfig>) => patch({ temp: { ...draft.temp, ...p } })
  const [newTime, setNewTime] = useState('12:00')

  const untilDay = localDay(draft.temp.until)

  return (
    <div className="card-form">
      <div className="cf-label">Front</div>
      <CardTextEditor
        value={draft.front}
        autoFocus={autoFocus}
        placeholder="The question, cue, or mantra… markdown and $math$ render live"
        onChange={front => patch({ front })}
      />
      <div className="cf-label">Back</div>
      <CardTextEditor
        value={draft.back}
        placeholder="The answer — optional for reminders"
        onChange={back => patch({ back })}
      />
      <label className="cf-label" htmlFor="cf-tags">Tags</label>
      <input
        id="cf-tags"
        className="cf-input"
        value={draft.tagsText}
        placeholder="comma, separated"
        onChange={e => patch({ tagsText: e.target.value })}
      />

      <div className="cf-label">Schedule</div>
      <div className="cf-types">
        {TYPES.map(t => (
          <button
            key={t.key}
            type="button"
            className={cx('cf-type', draft.type === t.key && 'is-active')}
            onClick={() => patch({ type: t.key })}
          >
            <t.icon size={14} strokeWidth={1.8} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="cf-blurb">{TYPES.find(t => t.key === draft.type)?.blurb}</div>

      {draft.type === 'routine' && (
        <div className="cf-config">
          <div className="cf-row">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={30}
              className="cf-mini"
              value={draft.routine.every}
              onChange={e => patchRoutine({ every: Math.max(1, Number(e.target.value) || 1) })}
            />
            <select
              className="cf-mini cf-select"
              value={draft.routine.unit}
              onChange={e => patchRoutine({ unit: e.target.value as RoutineConfig['unit'] })}
            >
              <option value="day">{draft.routine.every === 1 ? 'day' : 'days'}</option>
              <option value="week">{draft.routine.every === 1 ? 'week' : 'weeks'}</option>
              <option value="month">{draft.routine.every === 1 ? 'month' : 'months'}</option>
            </select>
          </div>
          <div className="cf-seg">
            {(
              [
                ['anytime', 'Anytime'],
                ['times', 'At times'],
                ['gaps', 'Spaced out'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={cx('cf-seg-btn', draft.routine.mode === mode && 'is-active')}
                onClick={() => patchRoutine({ mode })}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.routine.mode === 'times' && (
            <div className="cf-row cf-wrap">
              {draft.routine.times.map(t => (
                <span key={t} className="cf-chip">
                  {t}
                  <button
                    type="button"
                    className="cf-chip-x"
                    aria-label={`Remove ${t}`}
                    onClick={() => patchRoutine({ times: draft.routine.times.filter(x => x !== t) })}
                  >
                    <X size={11} strokeWidth={2.2} />
                  </button>
                </span>
              ))}
              <input
                type="time"
                className="cf-mini cf-time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
              />
              <button
                type="button"
                className="cf-add"
                onClick={() => {
                  if (newTime && !draft.routine.times.includes(newTime)) {
                    patchRoutine({ times: [...draft.routine.times, newTime].sort() })
                  }
                }}
              >
                <Plus size={13} strokeWidth={2} /> Add time
              </button>
            </div>
          )}
          {draft.routine.mode === 'gaps' && (
            <div className="cf-row">
              <input
                type="number"
                min={1}
                max={12}
                className="cf-mini"
                value={draft.routine.count}
                onChange={e => patchRoutine({ count: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span>sessions,</span>
              <input
                type="number"
                min={1}
                max={12}
                className="cf-mini"
                value={draft.routine.gapHours}
                onChange={e => patchRoutine({ gapHours: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span>h apart — first on open</span>
            </div>
          )}
        </div>
      )}

      {draft.type === 'temp' && (
        <div className="cf-config">
          <div className="cf-row">
            <input
              type="number"
              min={1}
              max={20}
              className="cf-mini"
              value={draft.temp.perDay}
              onChange={e => patchTemp({ perDay: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span>correct / day until</span>
            <input
              type="date"
              className="cf-mini cf-date"
              value={untilDay}
              onChange={e => {
                const [y, m, d] = e.target.value.split('-').map(Number)
                if (y && m && d) patchTemp({ until: new Date(y, m - 1, d, 23, 59, 59).getTime() })
              }}
            />
          </div>
          <div className="cf-row">
            <input
              type="number"
              min={0}
              max={480}
              className="cf-mini"
              value={draft.temp.gapMinutes}
              onChange={e => patchTemp({ gapMinutes: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span>min between reviews · archives itself after the date</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Anchored composer — sits to the right of the text block
// ---------------------------------------------------------------------------

export function CardComposer({
  refs,
  anchorTop,
  pageRight,
  capturing,
  onAddHighlight,
  onCancel,
  onCreate,
}: {
  refs: { refId: string; snapshot: string }[]
  anchorTop: number
  pageRight: number
  capturing: boolean
  onAddHighlight: () => void
  onCancel: () => void
  onCreate: (draft: CardDraft) => void
}) {
  const [draft, setDraft] = useState<CardDraft>(emptyDraft)
  const [expanded, setExpanded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Mid-capture the pop-up steps aside: the page is fully interactive and the
  // dot cursor shows; finishing (or cancelling) the highlight brings it back.
  const ghost = expanded && capturing

  // Reposition on any draft change: long card text grows the panel, and a
  // panel placed while short would push its footer below the viewport.
  // (The modal variant is centered by CSS instead.)
  useLayoutEffect(() => {
    if (expanded) return
    const el = panelRef.current
    if (!el) return
    const width = 344
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(pageRight + 24, vw - width - 16)
    const top = Math.max(58, Math.min(anchorTop - 20, vh - Math.min(el.offsetHeight, vh - 96) - 20))
    setPos({ top, left: Math.max(16, left) })
  }, [anchorTop, pageRight, refs.length, draft, expanded])

  return createPortal(
    <>
      {expanded && (
        <div
          className={cx('composer-backdrop', ghost && 'is-ghost')}
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        ref={panelRef}
        className={cx('composer', expanded && 'is-modal', ghost && 'is-ghost')}
        style={
          expanded
            ? undefined
            : pos
              ? { top: pos.top, left: pos.left }
              : { top: 0, left: 0, visibility: 'hidden' }
        }
      >
      <div className="composer-head">
        <span className="composer-title">New card</span>
        <span className="composer-head-btns">
          <button
            type="button"
            className="icon-btn sm"
            onClick={() => setExpanded(o => !o)}
            title={expanded ? 'Back to the side panel' : 'Expand'}
          >
            {expanded ? (
              <Minimize2 size={13} strokeWidth={1.8} />
            ) : (
              <Maximize2 size={13} strokeWidth={1.8} />
            )}
          </button>
          <button type="button" className="icon-btn sm" onClick={onCancel} title="Discard (removes highlights)">
            <X size={14} strokeWidth={1.8} />
          </button>
        </span>
      </div>

      <div className="composer-scroll">
        <button
          type="button"
          className={cx('composer-highlight', capturing && 'is-capturing')}
          onClick={onAddHighlight}
          disabled={capturing}
        >
          <Highlighter size={14} strokeWidth={1.8} />
          {capturing ? 'Select text in the page… (esc to stop)' : 'Add another highlight'}
        </button>

        <div className="composer-refs">
          {refs.map((r, i) => (
            <div key={r.refId} className="composer-ref">
              <span className="composer-ref-n">{i + 1}</span>
              <span className="composer-ref-text">{r.snapshot}</span>
            </div>
          ))}
        </div>

        <CardForm draft={draft} onChange={setDraft} autoFocus />
      </div>

      <div className="composer-foot">
        <span className="composer-hint">Highlight copied — ⌘V pastes it</span>
        <div className="composer-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft.front.trim()}
            onClick={() => onCreate(draft)}
          >
            Create card
          </button>
        </div>
      </div>
      </div>
    </>,
    document.body,
  )
}
