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

  createCard: (input: CreateCardInput) => string
  updateCard: (
    id: string,
    patch: Partial<Pick<SrsCard, 'front' | 'back' | 'tags' | 'type' | 'routine' | 'temp'>>,
  ) => void
  toggleArchive: (id: string) => void
  deleteCard: (id: string) => void
  reviewCard: (id: string, rating: 1 | 2 | 3 | 4, elapsedMs: number) => void
  /** Auto-archive expired temporary cards. Safe to call often. */
  sweep: (now?: number) => void
}

const snippet = (s: string) => (s.length > 60 ? s.slice(0, 57) + '…' : s) || 'Untitled card'

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

      createCard: input => {
        const id = input.id ?? crypto.randomUUID()
        const now = Date.now()
        const card: SrsCard = {
          id,
          front: input.front,
          back: input.back,
          tags: input.tags,
          pageId: input.pageId,
          refs: input.refs,
          type: input.type,
          routine: input.routine,
          temp: input.temp,
          fsrs: newFsrsState(new Date(now)),
          archived: false,
          createdAt: now,
          updatedAt: now,
        }
        set(s => ({ cards: { ...s.cards, [id]: card } }))
        recordCardVersion(card, 'create', scheduleLabel(card))
        appendEvent({ kind: 'card-create', label: snippet(card.front), cardId: id, pageId: input.pageId ?? undefined })
        snapshotSourcePage(input.pageId)
        return id
      },

      updateCard: (id, patch) => {
        const prev = get().cards[id]
        if (!prev) return
        const card: SrsCard = { ...prev, ...patch, updatedAt: Date.now() }
        set(s => ({ cards: { ...s.cards, [id]: card } }))
        recordCardVersion(card, 'edit', scheduleLabel(card))
        appendEvent({ kind: 'card-edit', label: snippet(card.front), cardId: id, pageId: card.pageId ?? undefined })
        snapshotSourcePage(card.pageId)
      },

      toggleArchive: id => {
        const prev = get().cards[id]
        if (!prev) return
        const archived = !prev.archived
        const card: SrsCard = {
          ...prev,
          archived,
          archivedAt: archived ? Date.now() : undefined,
          updatedAt: Date.now(),
        }
        set(s => ({ cards: { ...s.cards, [id]: card } }))
        recordCardVersion(card, archived ? 'archive' : 'unarchive', scheduleLabel(card))
        appendEvent({
          kind: archived ? 'card-archive' : 'card-unarchive',
          label: snippet(card.front),
          cardId: id,
          pageId: card.pageId ?? undefined,
        })
      },

      deleteCard: id => {
        const prev = get().cards[id]
        if (!prev) return
        set(s => {
          const cards = { ...s.cards }
          delete cards[id]
          return { cards }
        })
        appendEvent({ kind: 'card-delete', label: snippet(prev.front), cardId: id, pageId: prev.pageId ?? undefined })
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
        if (result.archived && !prev.archived) {
          recordCardVersion(card, 'archive', scheduleLabel(card))
          appendEvent({ kind: 'card-archive', label: snippet(card.front), cardId: id, pageId: card.pageId ?? undefined })
        }
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
        for (const c of expired) {
          const card = get().cards[c.id]
          recordCardVersion(card, 'archive', scheduleLabel(card))
          appendEvent({ kind: 'card-archive', label: snippet(card.front), cardId: c.id, pageId: card.pageId ?? undefined })
        }
      },
    }),
    {
      name: 'arete-srs',
      version: 1,
      partialize: s => ({ cards: s.cards, logs: s.logs }),
    },
  ),
)
