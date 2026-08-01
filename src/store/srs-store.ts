import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  CardRef,
  CardType,
  ReviewLogEntry,
  RoutineConfig,
  SrsCard,
  TempConfig,
} from './types'
import { applyReview, newFsrsState, scheduleLabel } from '../lib/srs'
import { appendEvent, recordCardVersion, recordPageVersion } from '../lib/history'
import { stripMd } from '../lib/util'
import { useStore } from './store'

const LOG_CAP = 20_000

export interface CreateCardInput {
  /** Pre-generated id — highlight marks in the page already point at it. */
  id?: string
  front: string
  back: string
  tags: string[]
  pageId: string | null
  refs: CardRef[]
  type: CardType
  routine?: RoutineConfig
  temp?: TempConfig
}

interface SrsState {
  cards: Record<string, SrsCard>
  logs: ReviewLogEntry[]
  /** Tombstones (id → deletedAt) so deletions replicate across devices
   * through the vault instead of resurrecting on merge. */
  graveyard: Record<string, number>

  createCard: (input: CreateCardInput) => string
  updateCard: (
    id: string,
    patch: Partial<Pick<SrsCard, 'front' | 'back' | 'tags' | 'pageId' | 'type' | 'routine' | 'temp'>>,
  ) => void
  toggleArchive: (id: string) => void
  deleteCard: (id: string) => void
  /** Archive or unarchive a whole selection. Returns how many actually
   * changed — cards already in the target state are left alone, so a mixed
   * selection can be squared up in one action. */
  setArchived: (ids: string[], archived: boolean) => number
  /** Delete a whole selection. Returns how many were removed. */
  deleteCards: (ids: string[]) => number
  reviewCard: (id: string, rating: 1 | 2 | 3 | 4, elapsedMs: number) => void
  /** Auto-archive expired temporary cards. Safe to call often. */
  sweep: (now?: number) => void
}

const snippet = (s: string) => { const t = stripMd(s); return (t.length > 60 ? t.slice(0, 57) + '…' : t) || 'Untitled card' }

/**
 * History, analytics and the source-page snapshot are bookkeeping. They run
 * *after* the card has already been written, and must not be able to fail the
 * action that wrote it: a throw here propagated all the way back into the
 * caller's click handler, so a card could be created and stored while its
 * composer stayed open with nothing to say it had worked.
 *
 * The card is the product; this is the paperwork. If the paperwork fails, say
 * so on the console and carry on.
 */
function journal(what: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error(`arete: ${what} history/analytics failed — the change itself is saved`, err)
  }
}

/** Snapshot the source page alongside card activity, per the history spec. */
function snapshotSourcePage(pageId: string | null) {
  if (!pageId) return
  const page = useStore.getState().pages[pageId]
  if (page) recordPageVersion(page, 'card')
}

export const useSrsStore = create<SrsState>()(
  persist(
    (set, get) => ({
      cards: {},
      logs: [],
      graveyard: {},

      createCard: input => {
        const id = input.id ?? crypto.randomUUID()
        const now = Date.now()
        const card: SrsCard = {
          id,
          front: input.front,
          back: input.back,
          tags: input.tags ?? [],
          pageId: input.pageId,
          refs: input.refs ?? [],
          type: input.type,
          routine: input.routine,
          temp: input.temp,
          fsrs: newFsrsState(new Date(now)),
          archived: false,
          createdAt: now,
          updatedAt: now,
        }
        set(s => {
          const graveyard = { ...s.graveyard }
          delete graveyard[id]
          return { cards: { ...s.cards, [id]: card }, graveyard }
        })
        journal('card-create', () => {
          recordCardVersion(card, 'create', scheduleLabel(card))
          appendEvent({ kind: 'card-create', label: snippet(card.front), cardId: id, pageId: input.pageId ?? undefined })
          snapshotSourcePage(input.pageId)
        })
        return id
      },

      updateCard: (id, patch) => {
        const prev = get().cards[id]
        if (!prev) return
        const card: SrsCard = { ...prev, ...patch, updatedAt: Date.now() }
        set(s => ({ cards: { ...s.cards, [id]: card } }))
        journal('card-edit', () => {
          recordCardVersion(card, 'edit', scheduleLabel(card))
          appendEvent({ kind: 'card-edit', label: snippet(card.front), cardId: id, pageId: card.pageId ?? undefined })
          snapshotSourcePage(card.pageId)
        })
      },

      toggleArchive: id => {
        const prev = get().cards[id]
        if (prev) get().setArchived([id], !prev.archived)
      },

      deleteCard: id => {
        get().deleteCards([id])
      },

      // Bulk actions write ONCE and then record history per card, the way
      // `sweep` does: a selection of two hundred cards must not mean two
      // hundred store writes, each waking persistence and the vault sync.
      setArchived: (ids, archived) => {
        const now = Date.now()
        const before = get().cards
        const changing = ids.filter(id => before[id] && before[id].archived !== archived)
        if (!changing.length) return 0
        set(s => {
          const cards = { ...s.cards }
          for (const id of changing) {
            cards[id] = {
              ...cards[id],
              archived,
              archivedAt: archived ? now : undefined,
              updatedAt: now,
            }
          }
          return { cards }
        })
        journal('card-archive', () => {
          for (const id of changing) {
            const card = get().cards[id]
            recordCardVersion(card, archived ? 'archive' : 'unarchive', scheduleLabel(card))
            appendEvent({
              kind: archived ? 'card-archive' : 'card-unarchive',
              label: snippet(card.front),
              cardId: id,
              pageId: card.pageId ?? undefined,
            })
          }
        })
        return changing.length
      },

      deleteCards: ids => {
        const before = get().cards
        const going = ids.map(id => before[id]).filter((c): c is SrsCard => !!c)
        if (!going.length) return 0
        const now = Date.now()
        set(s => {
          const cards = { ...s.cards }
          const graveyard = { ...s.graveyard }
          for (const card of going) {
            delete cards[card.id]
            // A tombstone, not just a removal: the vault merge would otherwise
            // resurrect the card from another device's copy.
            graveyard[card.id] = now
          }
          return { cards, graveyard }
        })
        journal('card-delete', () => {
          for (const card of going) {
            appendEvent({
              kind: 'card-delete',
              label: snippet(card.front),
              cardId: card.id,
              pageId: card.pageId ?? undefined,
            })
          }
        })
        return going.length
      },

      reviewCard: (id, rating, elapsedMs) => {
        const prev = get().cards[id]
        if (!prev) return
        const now = new Date()
        const result = applyReview(prev, rating, now)
        const card: SrsCard = {
          ...prev,
          fsrs: result.fsrs,
          day: result.day,
          daySlotsDone: result.daySlotsDone,
          lastCorrectAt: result.lastCorrectAt,
          archived: result.archived,
          archivedAt: result.archivedAt,
          // A review deliberately does NOT bump `updatedAt`: that field is the
          // content-edit time, and the merge treats it as authoritative against
          // deletion tombstones. If a review bumped it, reviewing a card that
          // was deleted on another device (before this device synced the
          // deletion) would out-rank the tombstone and resurrect the card.
          // Review recency still travels cross-device via fsrs.last_review,
          // which cardFreshness() folds in when choosing the freshest copy.
        }
        const entry: ReviewLogEntry = {
          id: crypto.randomUUID(),
          cardId: id,
          ts: now.getTime(),
          rating,
          elapsedMs,
          cardType: prev.type,
          pageId: prev.pageId,
          stability: result.fsrs.stability,
          difficulty: result.fsrs.difficulty,
          retrievability: result.retrievabilityBefore,
        }
        set(s => ({
          cards: { ...s.cards, [id]: card },
          logs: [...s.logs, entry].slice(-LOG_CAP),
        }))
        journal('card-review', () => {
          if (result.archived && !prev.archived) {
            recordCardVersion(card, 'archive', scheduleLabel(card))
            appendEvent({ kind: 'card-archive', label: snippet(card.front), cardId: id, pageId: card.pageId ?? undefined })
          }
        })
      },

      sweep: (now = Date.now()) => {
        const expired = Object.values(get().cards).filter(
          c => !c.archived && c.type === 'temp' && c.temp && now > c.temp.until,
        )
        if (!expired.length) return
        set(s => {
          const cards = { ...s.cards }
          for (const c of expired) {
            cards[c.id] = { ...c, archived: true, archivedAt: now, updatedAt: now }
          }
          return { cards }
        })
        journal('card-sweep', () => {
          for (const c of expired) {
            const card = get().cards[c.id]
            recordCardVersion(card, 'archive', scheduleLabel(card))
            appendEvent({ kind: 'card-archive', label: snippet(card.front), cardId: c.id, pageId: card.pageId ?? undefined })
          }
        })
      },
    }),
    {
      name: 'arete-srs',
      version: 1,
      partialize: s => ({ cards: s.cards, logs: s.logs, graveyard: s.graveyard }),
    },
  ),
)
