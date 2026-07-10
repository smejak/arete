import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { JSONContent } from '@tiptap/core'
import type { FontKey, Page } from './types'
import { buildSeed } from './seed'
import { childrenOf, descendantsOf, inSubtree, remapPageLinks } from '../lib/tree'

export type DropSpot = { type: 'before' | 'after' | 'inside'; id: string } | { type: 'root-end' }

/**
 * When set, the next page chosen in the search palette is handed to this
 * callback (e.g. "Link to page" from the slash menu) instead of navigated to.
 */
export const pagePick: { current: ((pageId: string) => void) | null } = { current: null }

interface AreteState {
  pages: Record<string, Page>
  favorites: string[]
  activePageId: string | null
  /** Sidebar expansion, keyed `section:pageId` so Favorites and Pages expand independently. */
  expanded: Record<string, boolean>
  sidebarOpen: boolean
  theme: 'light' | 'dark'
  searchOpen: boolean
  /** Page whose title input should grab focus on next mount (new/renamed pages). */
  pendingFocusId: string | null

  openPage: (id: string, opts?: { focusTitle?: boolean }) => void
  createPage: (opts?: {
    parentId?: string | null
    title?: string
    icon?: string | null
    navigate?: boolean
  }) => string
  updateTitle: (id: string, title: string) => void
  updateContent: (id: string, content: JSONContent) => void
  setIcon: (id: string, icon: string | null) => void
  setCover: (id: string, cover: string | null) => void
  setFont: (id: string, font: FontKey) => void
  toggleFavorite: (id: string) => void
  duplicatePage: (id: string) => string | null
  deletePage: (id: string) => void
  movePage: (id: string, spot: DropSpot) => void
  toggleExpand: (key: string) => void
  toggleSidebar: () => void
  toggleTheme: () => void
  setSearchOpen: (open: boolean) => void
  clearPendingFocus: () => void
}

const seed = buildSeed()

export const useStore = create<AreteState>()(
  persist(
    (set, get) => {
      const patch = (id: string, fn: (p: Page) => Page) =>
        set(s => (s.pages[id] ? { pages: { ...s.pages, [id]: fn(s.pages[id]) } } : s))

      return {
        pages: seed.pages,
        favorites: [],
        activePageId: seed.activePageId,
        expanded: seed.expanded,
        sidebarOpen: true,
        theme:
          typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light',
        searchOpen: false,
        pendingFocusId: null,

        openPage: (id, opts) => {
          if (!get().pages[id]) return
          set({ activePageId: id, searchOpen: false, pendingFocusId: opts?.focusTitle ? id : null })
        },

        createPage: (opts = {}) => {
          const id = crypto.randomUUID()
          const parentId = opts.parentId ?? null
          set(s => {
            const siblings = childrenOf(s.pages, parentId)
            const now = Date.now()
            const page: Page = {
              id,
              title: opts.title ?? '',
              icon: opts.icon ?? null,
              cover: null,
              parentId,
              order: siblings.length,
              font: (parentId ? s.pages[parentId]?.font : undefined) ?? 'sans',
              content: null,
              createdAt: now,
              updatedAt: now,
            }
            return {
              pages: { ...s.pages, [id]: page },
              ...(opts.navigate === false
                ? {}
                : { activePageId: id, pendingFocusId: id, searchOpen: false }),
              ...(parentId ? { expanded: { ...s.expanded, ['main:' + parentId]: true } } : {}),
            }
          })
          return id
        },

        updateTitle: (id, title) => patch(id, p => ({ ...p, title, updatedAt: Date.now() })),
        updateContent: (id, content) => patch(id, p => ({ ...p, content, updatedAt: Date.now() })),
        setIcon: (id, icon) => patch(id, p => ({ ...p, icon, updatedAt: Date.now() })),
        setCover: (id, cover) => patch(id, p => ({ ...p, cover, updatedAt: Date.now() })),
        setFont: (id, font) => patch(id, p => ({ ...p, font, updatedAt: Date.now() })),

        toggleFavorite: id =>
          set(s => ({
            favorites: s.favorites.includes(id)
              ? s.favorites.filter(f => f !== id)
              : [...s.favorites, id],
          })),

        duplicatePage: id => {
          const s = get()
          const src = s.pages[id]
          if (!src) return null
          const pages = { ...s.pages }
          const map = new Map<string, string>()

          const cloneTree = (srcId: string, parentId: string | null, order: number): string => {
            const from = s.pages[srcId]
            const nid = crypto.randomUUID()
            map.set(srcId, nid)
            const now = Date.now()
            pages[nid] = {
              ...from,
              id: nid,
              parentId,
              order,
              content: from.content ? (JSON.parse(JSON.stringify(from.content)) as JSONContent) : null,
              createdAt: now,
              updatedAt: now,
            }
            childrenOf(s.pages, srcId).forEach((c, i) => cloneTree(c.id, nid, i))
            return nid
          }

          const nid = cloneTree(id, src.parentId, 0)
          pages[nid] = { ...pages[nid], title: (src.title || 'Untitled') + ' (copy)' }

          // Slot the copy directly after the original.
          const order = childrenOf(s.pages, src.parentId).map(p => p.id)
          order.splice(order.indexOf(id) + 1, 0, nid)
          order.forEach((pid, i) => {
            pages[pid] = { ...pages[pid], order: i }
          })

          // Links inside the copied subtree should point at the copies.
          for (const newId of map.values()) {
            const pg = pages[newId]
            if (pg.content) pages[newId] = { ...pg, content: remapPageLinks(pg.content, map) }
          }

          set({ pages })
          return nid
        },

        deletePage: id => {
          const s = get()
          if (!s.pages[id]) return
          const ids = new Set([id, ...descendantsOf(s.pages, id)])
          const parentId = s.pages[id].parentId
          const pages: Record<string, Page> = {}
          for (const [pid, p] of Object.entries(s.pages)) if (!ids.has(pid)) pages[pid] = p
          childrenOf(pages, parentId).forEach((p, i) => {
            pages[p.id] = { ...p, order: i }
          })
          const favorites = s.favorites.filter(f => !ids.has(f))
          const expanded: Record<string, boolean> = {}
          for (const [k, v] of Object.entries(s.expanded)) {
            const pid = k.slice(k.indexOf(':') + 1)
            if (!ids.has(pid)) expanded[k] = v
          }
          let activePageId = s.activePageId
          if (activePageId && ids.has(activePageId)) {
            activePageId = childrenOf(pages, null)[0]?.id ?? null
          }
          set({ pages, favorites, expanded, activePageId })
          if (!activePageId) get().createPage({})
        },

        movePage: (id, spot) => {
          const s = get()
          const pages = { ...s.pages }
          const page = pages[id]
          if (!page) return
          if (spot.type !== 'root-end') {
            if (!pages[spot.id] || spot.id === id) return
            if (inSubtree(pages, spot.id, id)) return // can't drop into own subtree
          }

          const oldParent = page.parentId
          let newParent: string | null
          let index: number
          if (spot.type === 'root-end') {
            newParent = null
            index = Number.MAX_SAFE_INTEGER
          } else if (spot.type === 'inside') {
            newParent = spot.id
            index = Number.MAX_SAFE_INTEGER
          } else {
            newParent = pages[spot.id].parentId
            const sibs = childrenOf(pages, newParent).filter(p => p.id !== id)
            const at = sibs.findIndex(p => p.id === spot.id)
            index = spot.type === 'before' ? at : at + 1
          }

          pages[id] = { ...page, parentId: newParent, updatedAt: Date.now() }
          const sibs = childrenOf(pages, newParent).filter(p => p.id !== id)
          sibs.splice(Math.max(0, Math.min(index, sibs.length)), 0, pages[id])
          sibs.forEach((p, i) => {
            pages[p.id] = { ...pages[p.id], order: i }
          })
          if (oldParent !== newParent) {
            childrenOf(pages, oldParent).forEach((p, i) => {
              pages[p.id] = { ...pages[p.id], order: i }
            })
          }

          set({
            pages,
            ...(spot.type === 'inside'
              ? { expanded: { ...s.expanded, ['main:' + spot.id]: true } }
              : {}),
          })
        },

        toggleExpand: key => set(s => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),
        toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
        toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
        setSearchOpen: open => {
          if (!open) pagePick.current = null
          set({ searchOpen: open })
        },
        clearPendingFocus: () => set({ pendingFocusId: null }),
      }
    },
    {
      name: 'arete',
      version: 1,
      partialize: s => ({
        pages: s.pages,
        favorites: s.favorites,
        activePageId: s.activePageId,
        expanded: s.expanded,
        sidebarOpen: s.sidebarOpen,
        theme: s.theme,
      }),
    },
  ),
)
