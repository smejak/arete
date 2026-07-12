import type { ReviewLogEntry, SrsCard } from '../store/types'

/**
 * Cross-device merge for the flashcard state that lives in the vault
 * (`.arete/cards.json` + `.arete/logs.json`). The desktop app and the iPhone
 * app both funnel reads and writes through these helpers, so concurrent
 * reviews on two devices converge instead of clobbering each other:
 *
 * - logs are append-only → union by log id
 * - the freshest copy of each card wins (edits AND reviews bump `updatedAt`)
 * - deletions are tombstones in a graveyard so they replicate instead of
 *   resurrecting; tombstones expire after 90 days
 */

export interface CardSet {
  cards: Record<string, SrsCard>
  graveyard: Record<string, number>
}

export const EMPTY_CARD_SET: CardSet = { cards: {}, graveyard: {} }
export const LOG_CAP = 20_000
const GRAVE_TTL = 90 * 24 * 3600 * 1000

export function cardFreshness(c: SrsCard): number {
  const reviewed = c.fsrs?.last_review ? new Date(c.fsrs.last_review).getTime() : 0
  return Math.max(c.updatedAt ?? 0, Number.isFinite(reviewed) ? reviewed : 0)
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

export function mergeCardSets(
  local: CardSet,
  remote: CardSet,
  now = Date.now(),
): CardSet & { changedVsLocal: boolean } {
  const graveyard: Record<string, number> = {}
  for (const [id, ts] of [...Object.entries(local.graveyard), ...Object.entries(remote.graveyard)]) {
    if (typeof ts === 'number' && now - ts < GRAVE_TTL) {
      graveyard[id] = Math.max(graveyard[id] ?? 0, ts)
    }
  }

  const cards: Record<string, SrsCard> = {}
  const consider = (c: SrsCard) => {
    if (!c?.id) return
    const cur = cards[c.id]
    if (!cur || cardFreshness(c) > cardFreshness(cur)) cards[c.id] = c
  }
  Object.values(local.cards).forEach(consider)
  Object.values(remote.cards).forEach(consider)

  for (const id of Object.keys(cards)) {
    const buried = graveyard[id]
    if (!buried) continue
    if (cardFreshness(cards[id]) <= buried) delete cards[id]
    else delete graveyard[id] // the card outlived its tombstone (recreated)
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
  if (!remote.length) return { logs: local, changedVsLocal: false }
  const seen = new Set(local.map(l => l.id))
  const fresh = remote.filter(l => l?.id && !seen.has(l.id))
  if (!fresh.length) return { logs: local, changedVsLocal: false }
  const logs = [...local, ...fresh].sort((a, b) => a.ts - b.ts).slice(-LOG_CAP)
  return { logs, changedVsLocal: true }
}
