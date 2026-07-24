import type { JSONContent } from '@tiptap/core'
import type { CardType, Page, SrsCard } from '../store/types'

/**
 * Version history, modeled on aim's plan-map log but linear: immutable dated
 * versions with a no-op guard (unchanged content mints nothing) and a cause
 * tag per version. Each page/card gets its own localStorage key so the hot
 * page-autosave path never rewrites history blobs.
 */

export type PageCause = 'create' | 'idle' | 'card' | 'interval' | 'switch' | 'restore' | 'pre-restore'
export type CardCause = 'create' | 'edit' | 'archive' | 'unarchive' | 'restore'

export interface PageVersion {
  id: string
  ts: number
  cause: PageCause
  title: string
  icon: string | null
  content: JSONContent | null
}

export interface CardVersion {
  id: string
  ts: number
  cause: CardCause
  front: string
  back: string
  tags: string[]
  type: CardType
  schedule: string
}

export type KbEventKind =
  | 'page-save'
  | 'page-create'
  | 'page-delete'
  | 'page-restore'
  | 'card-create'
  | 'card-edit'
  | 'card-archive'
  | 'card-unarchive'
  | 'card-delete'

export interface KbEvent {
  id: string
  ts: number
  kind: KbEventKind
  label: string
  pageId?: string
  cardId?: string
}

const PAGE_KEY = (id: string) => `arete.hist.page.${id}`
const CARD_KEY = (id: string) => `arete.hist.card.${id}`
const EVENTS_KEY = 'arete.hist.events'
const PAGE_CAP = 80
const CARD_CAP = 60
const EVENTS_CAP = 1500

// -- tiny external-store signal so history views re-render on writes --------

let counter = 0
const subs = new Set<() => void>()
export const subscribeHistory = (cb: () => void) => {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}
export const historyVersion = () => counter
const bump = () => {
  counter++
  subs.forEach(f => f())
}

// -- in-memory store (mirrored to the vault's .arete/history.json) -----------
//
// History used to live in localStorage, but every version keeps a FULL content
// snapshot (up to PAGE_CAP per page), which blows past its ~5 MB cap on a real
// vault — and a write throwing mid-render blanked the whole app. The vault
// folder is the durable copy now (dumped to `.arete/history.json`, restored on
// load), so the live store is a plain in-memory map: no quota, no throw. The
// same string-in/string-out contract as localStorage keeps dump/restore trivial.

const mem = new Map<string, string>()

// One-time migration: lift any history left in localStorage by an older build
// into memory and free the space, so existing vaults stop hitting the cap.
try {
  const stale: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('arete.hist.')) stale.push(k)
  }
  for (const k of stale) {
    const v = localStorage.getItem(k)
    if (v != null) mem.set(k, v)
    localStorage.removeItem(k)
  }
} catch {
  /* no localStorage (tests) — nothing to migrate */
}

function read<T>(key: string): T[] {
  try {
    const raw = mem.get(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown[]) {
  mem.set(key, JSON.stringify(value))
}

/** Keep the first version (origin) plus the most recent `cap - 1`. */
function trim<T>(versions: T[], cap: number): T[] {
  if (versions.length <= cap) return versions
  return [versions[0], ...versions.slice(versions.length - (cap - 1))]
}

// -- pages -------------------------------------------------------------------

export function readPageHistory(pageId: string): PageVersion[] {
  return read<PageVersion>(PAGE_KEY(pageId))
}

/** Mint a page version. No-op guard: skips when nothing changed since the
 * last version. Returns true when a version was actually recorded. */
export function recordPageVersion(page: Page, cause: PageCause): boolean {
  const versions = readPageHistory(page.id)
  const last = versions[versions.length - 1]
  const contentStr = JSON.stringify(page.content ?? null)
  if (
    last &&
    last.title === page.title &&
    last.icon === page.icon &&
    JSON.stringify(last.content ?? null) === contentStr
  ) {
    return false
  }
  versions.push({
    id: crypto.randomUUID(),
    ts: Date.now(),
    cause,
    title: page.title,
    icon: page.icon,
    content: page.content ? (JSON.parse(contentStr) as JSONContent) : null,
  })
  write(PAGE_KEY(page.id), trim(versions, PAGE_CAP))
  if (cause !== 'create') {
    appendEvent({
      kind: cause === 'restore' ? 'page-restore' : 'page-save',
      label: page.title || 'Untitled',
      pageId: page.id,
    })
  }
  bump()
  return true
}

export function dropPageHistory(pageId: string) {
  mem.delete(PAGE_KEY(pageId))
}

// -- vault mirror (whole history ⇄ .arete/history.json) ----------------------

/** Serialize every history entry (pages, cards, events) into one JSON blob for
 * the vault file. */
export function dumpHistory(): string {
  const dump: Record<string, unknown> = {}
  for (const [key, raw] of mem) {
    try {
      dump[key] = JSON.parse(raw)
    } catch {
      /* skip */
    }
  }
  return JSON.stringify(dump)
}

/** Replace the in-memory history with a vault dump. Falsy input is a no-op;
 * '{}' clears it (a fresh workspace). */
export function restoreHistory(json: string | null) {
  if (!json) return
  try {
    const dump = JSON.parse(json) as Record<string, unknown>
    mem.clear()
    for (const [key, value] of Object.entries(dump)) {
      mem.set(key, JSON.stringify(value))
    }
    bump()
  } catch {
    /* best-effort */
  }
}

// -- cards -------------------------------------------------------------------

export function readCardHistory(cardId: string): CardVersion[] {
  return read<CardVersion>(CARD_KEY(cardId))
}

export function recordCardVersion(card: SrsCard, cause: CardCause, schedule: string) {
  const versions = readCardHistory(card.id)
  const last = versions[versions.length - 1]
  if (
    last &&
    cause === 'edit' &&
    last.front === card.front &&
    last.back === card.back &&
    last.type === card.type &&
    last.schedule === schedule &&
    JSON.stringify(last.tags) === JSON.stringify(card.tags)
  ) {
    return
  }
  versions.push({
    id: crypto.randomUUID(),
    ts: Date.now(),
    cause,
    front: card.front,
    back: card.back,
    tags: [...card.tags],
    type: card.type,
    schedule,
  })
  write(CARD_KEY(card.id), trim(versions, CARD_CAP))
  bump()
}

// -- knowledge-base timeline ---------------------------------------------------

export function readEvents(): KbEvent[] {
  return read<KbEvent>(EVENTS_KEY)
}

export function appendEvent(event: Omit<KbEvent, 'id' | 'ts'>) {
  const events = readEvents()
  events.push({ id: crypto.randomUUID(), ts: Date.now(), ...event })
  write(EVENTS_KEY, events.slice(-EVENTS_CAP))
  bump()
}
