import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs'
import type { FsrsState, SrsCard } from '../store/types'

export { Rating }

const engine = fsrs(generatorParameters({ enable_fuzz: true }))

// ---------------------------------------------------------------------------
// FSRS state (de)serialization
// ---------------------------------------------------------------------------

export function newFsrsState(now = new Date()): FsrsState {
  return toStored(createEmptyCard(now))
}

function toStored(card: FsrsCard): FsrsState {
  return {
    due: new Date(card.due).toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? new Date(card.last_review).toISOString() : undefined,
  }
}

function toLive(state: FsrsState): FsrsCard {
  return {
    ...state,
    due: new Date(state.due),
    last_review: state.last_review ? new Date(state.last_review) : undefined,
  } as FsrsCard
}

// ---------------------------------------------------------------------------
// Local-date helpers
// ---------------------------------------------------------------------------

export function localDay(ts: number | Date): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function startOfDay(ts: number | Date): Date {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d
}

const DAY_MS = 86_400_000

/** Whole local days between two dates' midnights. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = startOfDay(day)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// Due computation
// ---------------------------------------------------------------------------

/** Day-progress fields, normalized so stale progress from a previous day reads as zero. */
function dayProgress(card: SrsCard, now: Date): { done: number; lastCorrectAt: number | null } {
  if (card.day !== localDay(now)) return { done: 0, lastCorrectAt: null }
  return { done: card.daySlotsDone ?? 0, lastCorrectAt: card.lastCorrectAt ?? null }
}

/** Is `day` one of this routine card's scheduled days? */
function isScheduledDay(card: SrsCard, day: Date): boolean {
  const cfg = card.routine!
  const anchor = startOfDay(card.createdAt)
  if (cfg.unit === 'day') {
    const diff = daysBetween(anchor, day)
    return diff >= 0 && diff % Math.max(1, cfg.every) === 0
  }
  if (cfg.unit === 'week') {
    const diff = daysBetween(anchor, day)
    return diff >= 0 && diff % 7 === 0 && (diff / 7) % Math.max(1, cfg.every) === 0
  }
  // month: same day-of-month (clamped to the month's length)
  const a = new Date(card.createdAt)
  const months = (day.getFullYear() - a.getFullYear()) * 12 + (day.getMonth() - a.getMonth())
  if (months < 0 || months % Math.max(1, cfg.every) !== 0) return false
  const lastOfMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
  return day.getDate() === Math.min(a.getDate(), lastOfMonth)
}

function nextScheduledDay(card: SrsCard, from: Date): Date {
  const probe = startOfDay(from)
  for (let i = 0; i < 750; i++) {
    probe.setDate(probe.getDate() + 1)
    if (isScheduledDay(card, probe)) return new Date(probe)
  }
  return new Date(probe)
}

/**
 * When is this card next due? Returns a timestamp (may be in the past =
 * due now), or null when it can never come due (archived / expired).
 */
export function dueAt(card: SrsCard, now: Date): number | null {
  if (card.archived) return null

  if (card.type === 'temp' && card.temp) {
    if (now.getTime() > card.temp.until) return null // expired — sweep will archive
    const { done, lastCorrectAt } = dayProgress(card, now)
    if (done >= card.temp.perDay) {
      const tomorrow = startOfDay(now)
      tomorrow.setDate(tomorrow.getDate() + 1)
      return tomorrow.getTime() > card.temp.until ? null : tomorrow.getTime()
    }
    if (!lastCorrectAt || card.temp.gapMinutes <= 0) return startOfDay(now).getTime()
    return lastCorrectAt + card.temp.gapMinutes * 60_000
  }

  if (card.type === 'routine' && card.routine) {
    const cfg = card.routine
    const today = startOfDay(now)
    if (isScheduledDay(card, today)) {
      const { done, lastCorrectAt } = dayProgress(card, now)
      if (cfg.mode === 'anytime') {
        if (done < 1) return today.getTime()
      } else if (cfg.mode === 'times') {
        const times = [...cfg.times].sort()
        if (done < times.length) return atTime(today, times[done]).getTime()
      } else {
        // gaps
        if (done < Math.max(1, cfg.count)) {
          if (done === 0 || !lastCorrectAt) return today.getTime()
          return lastCorrectAt + cfg.gapHours * 3_600_000
        }
      }
    }
    const next = nextScheduledDay(card, today)
    if (cfg.mode === 'times' && cfg.times.length) {
      return atTime(next, [...cfg.times].sort()[0]).getTime()
    }
    return next.getTime()
  }

  // standard — FSRS owns the schedule
  return new Date(card.fsrs.due).getTime()
}

export function isDue(card: SrsCard, now: Date): boolean {
  const due = dueAt(card, now)
  return due !== null && due <= now.getTime()
}

// ---------------------------------------------------------------------------
// Reviewing
// ---------------------------------------------------------------------------

export interface ReviewResult {
  fsrs: FsrsState
  day: string
  daySlotsDone: number
  lastCorrectAt?: number
  archived: boolean
  archivedAt?: number
  retrievabilityBefore: number
}

/** Apply a rating. Always updates the FSRS memory model; routine/temp cards
 * additionally advance their own schedule only on correct (rating > Again). */
export function applyReview(card: SrsCard, rating: 1 | 2 | 3 | 4, now: Date): ReviewResult {
  const live = toLive(card.fsrs)
  const retrievabilityBefore = retrievability(card, now)
  const next = engine.next(live, now, rating as Grade)
  const correct = rating > Rating.Again

  const progress = dayProgress(card, now)
  const day = localDay(now)
  let daySlotsDone = progress.done
  let lastCorrectAt = progress.lastCorrectAt ?? undefined

  if ((card.type === 'routine' || card.type === 'temp') && correct) {
    daySlotsDone += 1
    lastCorrectAt = now.getTime()
  }

  let archived = card.archived
  let archivedAt = card.archivedAt
  if (card.type === 'temp' && card.temp && now.getTime() >= card.temp.until) {
    archived = true
    archivedAt = now.getTime()
  }

  return {
    fsrs: toStored(next.card),
    day,
    daySlotsDone,
    lastCorrectAt,
    archived,
    archivedAt,
    retrievabilityBefore,
  }
}

/** Estimated probability of recall right now — the "knowledge" metric.
 * Works for archived cards too: memory keeps decaying after archival. */
export function retrievability(card: SrsCard, now: Date): number {
  if (card.fsrs.reps === 0) return 0
  try {
    const r = engine.get_retrievability(toLive(card.fsrs), now, false)
    return typeof r === 'number' && Number.isFinite(r) ? r : 0
  } catch {
    // power forgetting-curve fallback
    const last = card.fsrs.last_review ? new Date(card.fsrs.last_review).getTime() : null
    if (!last || card.fsrs.stability <= 0) return 0
    const t = Math.max(0, (now.getTime() - last) / DAY_MS)
    return Math.pow(1 + t / (9 * card.fsrs.stability), -1)
  }
}

/** Predicted next intervals for the four ratings (standard cards). */
export function previewIntervals(card: SrsCard, now: Date): Record<1 | 2 | 3 | 4, string> {
  const rec = engine.repeat(toLive(card.fsrs), now)
  const label = (g: Grade) => {
    const due = new Date(rec[g].card.due).getTime()
    return fmtInterval(due - now.getTime())
  }
  return {
    1: label(Rating.Again as Grade),
    2: label(Rating.Hard as Grade),
    3: label(Rating.Good as Grade),
    4: label(Rating.Easy as Grade),
  }
}

export function fmtInterval(ms: number): string {
  if (ms < 60_000) return '<1m'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m`
  const hrs = Math.round(min / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round((days / 365) * 10) / 10}y`
}

/** Human description of a card's schedule, for chips and lists. */
export function scheduleLabel(card: SrsCard): string {
  if (card.type === 'routine' && card.routine) {
    const c = card.routine
    const unit = c.every === 1 ? c.unit : `${c.every} ${c.unit}s`
    const per =
      c.mode === 'times'
        ? c.times.length > 1
          ? ` · ${c.times.length}× at ${c.times.join(', ')}`
          : c.times.length === 1
            ? ` at ${c.times[0]}`
            : ''
        : c.mode === 'gaps'
          ? ` · ${c.count}× / ${c.gapHours}h apart`
          : ''
    return `every ${unit}${per}`
  }
  if (card.type === 'temp' && card.temp) {
    return `${card.temp.perDay}×/day until ${new Date(card.temp.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  return 'spaced repetition'
}
