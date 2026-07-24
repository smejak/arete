import type { ReviewLogEntry, SrsCard } from '../store/types'

/**
 * Cross-device merge for the flashcard state that lives in the vault.
 *
 * Since v3 every device owns its own file — `.arete/srs/<deviceId>.json`,
 * holding that device's full view (cards + graveyard + logs) — and each sync
 * reads EVERYONE's files, merges in memory, and rewrites only its own. No two
 * writers ever touch the same file, so an eventually-consistent transport
 * (iCloud) can delay convergence but can never fork or lose a write the way
 * two devices overwriting one shared cards.json could. The legacy files
 * (`.arete/cards.json` + `logs.json`) remain as a desktop-written mirror so
 * older builds and external tools keep working.
 *
 * Merge rules:
 * - logs are append-only → union by log id (reviews on both devices sum)
 * - cards merge PER FIELD-GROUP when the same id diverged:
 *   · content (front/back/tags/type/pageId/…) follows the latest `updatedAt`
 *   · scheduling (fsrs, day counters) follows the latest `fsrs.last_review`
 *   so an edit on one device and a review on the other both survive.
 * - deletions are tombstones in a graveyard so they replicate instead of
 *   resurrecting; tombstones expire after 90 days. A tombstone is only
 *   overturned by a genuine EDIT after the deletion (compared via `updatedAt`),
 *   never by a review — otherwise a stale review could un-delete a card.
 */

export interface CardSet {
  cards: Record<string, SrsCard>
  graveyard: Record<string, number>
}

/** One device's full view, as stored in `.arete/srs/<device>.json`. */
export interface DeviceState extends CardSet {
  logs: ReviewLogEntry[]
  device: string
  /** Human label for diagnostics — 'Mac', 'iPhone'. */
  kind: string
  /** When this device last CHANGED its file (not merely synced). */
  writtenAt: number
}

export const EMPTY_CARD_SET: CardSet = { cards: {}, graveyard: {} }
export const LOG_CAP = 20_000
const GRAVE_TTL = 90 * 24 * 3600 * 1000

export function cardFreshness(c: SrsCard): number {
  return Math.max(c.updatedAt ?? 0, scheduleFreshness(c))
}

/** Review recency: applyReview refreshes fsrs.last_review for every card
 * type, so this is the authoritative "when did a review last touch it". */
export function scheduleFreshness(c: SrsCard): number {
  const reviewed = c.fsrs?.last_review ? new Date(c.fsrs.last_review).getTime() : 0
  return Number.isFinite(reviewed) ? reviewed : 0
}

/** Combine two copies of the same card: newest content, newest schedule —
 * independently, so edit-here + review-there keeps both. */
function mergeCard(a: SrsCard, b: SrsCard): SrsCard {
  const content = (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a
  const schedule = scheduleFreshness(b) > scheduleFreshness(a) ? b : a
  if (content === schedule) return content
  return {
    ...content,
    fsrs: schedule.fsrs,
    day: schedule.day,
    daySlotsDone: schedule.daySlotsDone,
    lastCorrectAt: schedule.lastCorrectAt,
  }
}

/** cards.json is `{version: 2, cards, graveyard}`; v1 files were a bare map. */
export function decodeCardsFile(text: string | null): CardSet | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null
    if ('cards' in parsed) {
      return {
        cards: (parsed.cards as Record<string, SrsCard>) ?? {},
        graveyard: (parsed.graveyard as Record<string, number>) ?? {},
      }
    }
    return { cards: parsed as Record<string, SrsCard>, graveyard: {} }
  } catch {
    return null
  }
}

export function encodeCardsFile(set: CardSet): string {
  return JSON.stringify({ version: 2, cards: set.cards, graveyard: set.graveyard }, null, 2)
}

export function decodeLogsFile(text: string | null): ReviewLogEntry[] {
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? (parsed as ReviewLogEntry[]) : []
  } catch {
    return []
  }
}

export function encodeDeviceFile(state: DeviceState): string {
  return JSON.stringify(
    {
      version: 3,
      device: state.device,
      kind: state.kind,
      writtenAt: state.writtenAt,
      cards: state.cards,
      graveyard: state.graveyard,
      logs: state.logs,
    },
    null,
    2,
  )
}

export function decodeDeviceFile(text: string | null): DeviceState | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object' || !('cards' in parsed)) return null
    return {
      cards: (parsed.cards as Record<string, SrsCard>) ?? {},
      graveyard: (parsed.graveyard as Record<string, number>) ?? {},
      logs: Array.isArray(parsed.logs) ? (parsed.logs as ReviewLogEntry[]) : [],
      device: typeof parsed.device === 'string' ? parsed.device : 'unknown',
      kind: typeof parsed.kind === 'string' ? parsed.kind : 'Device',
      writtenAt: typeof parsed.writtenAt === 'number' ? parsed.writtenAt : 0,
    }
  } catch {
    return null
  }
}

export function mergeCardSets(
  local: CardSet,
  remote: CardSet,
  now = Date.now(),
): CardSet & { changedVsLocal: boolean } {
  return mergeManyCardSets(local, [remote], now)
}

/** Fold any number of remote sets (legacy file + every device file) into the
 * local view. Object identity is preserved for untouched local cards, so the
 * changedVsLocal flag stays a cheap reference check. */
export function mergeManyCardSets(
  local: CardSet,
  remotes: CardSet[],
  now = Date.now(),
): CardSet & { changedVsLocal: boolean } {
  const graveyard: Record<string, number> = {}
  const buryAll = (g: Record<string, number>) => {
    for (const [id, ts] of Object.entries(g)) {
      if (typeof ts === 'number' && now - ts < GRAVE_TTL) {
        graveyard[id] = Math.max(graveyard[id] ?? 0, ts)
      }
    }
  }
  buryAll(local.graveyard)
  remotes.forEach(r => buryAll(r.graveyard))

  const cards: Record<string, SrsCard> = {}
  const consider = (c: SrsCard) => {
    if (!c?.id) return
    const cur = cards[c.id]
    cards[c.id] = cur ? mergeCard(cur, c) : c
  }
  Object.values(local.cards).forEach(consider)
  remotes.forEach(r => Object.values(r.cards).forEach(consider))

  for (const id of Object.keys(cards)) {
    const buried = graveyard[id]
    if (!buried) continue
    // Compare against the card's content-edit time (`updatedAt`), NOT
    // review recency: a review must not un-bury a card deleted elsewhere.
    // Only a genuine edit after the deletion counts as a recreate.
    const editedAt = cards[id].updatedAt ?? 0
    if (editedAt <= buried) delete cards[id]
    else delete graveyard[id] // edited after deletion → genuinely recreated
  }

  const localIds = Object.keys(local.cards)
  const cardsChanged =
    localIds.length !== Object.keys(cards).length || localIds.some(id => cards[id] !== local.cards[id])
  const graveIds = Object.keys(graveyard)
  const graveChanged =
    graveIds.length !== Object.keys(local.graveyard).length ||
    graveIds.some(id => graveyard[id] !== local.graveyard[id])
  return { cards, graveyard, changedVsLocal: cardsChanged || graveChanged }
}

export function mergeLogs(
  local: ReviewLogEntry[],
  remote: ReviewLogEntry[],
): { logs: ReviewLogEntry[]; changedVsLocal: boolean } {
  return mergeManyLogs(local, [remote])
}

export function mergeManyLogs(
  local: ReviewLogEntry[],
  remotes: ReviewLogEntry[][],
): { logs: ReviewLogEntry[]; changedVsLocal: boolean } {
  const seen = new Set(local.map(l => l.id))
  const fresh: ReviewLogEntry[] = []
  for (const remote of remotes) {
    for (const l of remote) {
      if (l?.id && !seen.has(l.id)) {
        seen.add(l.id)
        fresh.push(l)
      }
    }
  }
  if (!fresh.length) return { logs: local, changedVsLocal: false }
  const logs = [...local, ...fresh].sort((a, b) => a.ts - b.ts).slice(-LOG_CAP)
  return { logs, changedVsLocal: true }
}
