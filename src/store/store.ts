import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { JSONContent } from '@tiptap/core'
import type {
  CellValue,
  ColumnMeta,
  DatabaseDef,
  FieldType,
  FilterNode,
  FontKey,
  Page,
  TableView,
} from './types'
import { buildSeed } from './seed'
import {
  childrenOf,
  descendantsOf,
  hasPageLink,
  inSubtree,
  remapPageLinks,
  stripOwnedLink,
} from '../lib/tree'
import { appendEvent, recordPageVersion, type PageVersion } from '../lib/history'
import { changeFieldType, createDatabaseDef, defaultFieldName } from '../lib/db'

export type DropSpot = { type: 'before' | 'after' | 'inside'; id: string } | { type: 'root-end' }

export type AppView = 'page' | 'review' | 'cards' | 'insights'

export interface NavLoc {
  view: AppView
  pageId: string | null
}

export interface Tab {
  id: string
  loc: NavLoc
  back: NavLoc[]
  forward: NavLoc[]
}

const sameLoc = (a: NavLoc, b: NavLoc) => a.view === b.view && a.pageId === b.pageId

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
  /** Which main surface is showing. */
  view: AppView
  /** Card whose highlights should flash in the open page, then clear. */
  flash: { cardId: string; pageId: string } | null
  /** Bumped when a page is restored from history so the editor remounts. */
  restoreNonce: number
  /** Open tabs; `view`/`activePageId` always mirror the active tab's loc. */
  tabs: Tab[]
  activeTabId: string | null
  /** Page shown in the right-side peek panel (table rows open here). */
  peekPageId: string | null

  setView: (view: AppView) => void
  flashRefs: (cardId: string, pageId: string) => void
  clearFlash: () => void
  restorePage: (id: string, version: PageVersion) => void
  goBack: () => void
  goForward: () => void
  newTab: (loc?: NavLoc) => void
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  ensureTabs: () => void
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
  setPeek: (pageId: string | null) => void

  // ----- databases (schema on the db page, rows = child pages) -----
  createDatabase: (opts: { parentId: string | null; title?: string }) => string
  dbUpdate: (dbId: string, fn: (db: DatabaseDef) => DatabaseDef) => void
  dbUpdateView: (dbId: string, viewId: string, patch: Partial<Omit<TableView, 'id' | 'type'>>) => void
  dbSetColumnMeta: (dbId: string, viewId: string, fieldId: string, patch: Partial<ColumnMeta>) => void
  dbAddField: (dbId: string, type: FieldType, opts?: { beforeId?: string; afterId?: string }) => string
  dbChangeFieldType: (dbId: string, fieldId: string, toType: FieldType) => void
  dbDuplicateField: (dbId: string, fieldId: string) => void
  dbRemoveField: (dbId: string, fieldId: string) => void
  dbAddRow: (dbId: string, opts?: { afterId?: string }) => string
  dbDeleteRows: (ids: string[]) => void
  dbSetCell: (rowId: string, fieldId: string, value: CellValue) => void
}

const seed = buildSeed()

export const useStore = create<AreteState>()(
  persist(
    (set, get) => {
      const patch = (id: string, fn: (p: Page) => Page) =>
        set(s => (s.pages[id] ? { pages: { ...s.pages, [id]: fn(s.pages[id]) } } : s))

      /** Route the active tab to `loc`, recording history; mirrors view/activePageId. */
      const navigate = (s: AreteState, loc: NavLoc): Partial<AreteState> => {
        let tabs = s.tabs
        let activeTabId = s.activeTabId
        const active = tabs.find(t => t.id === activeTabId)
        if (!active) {
          const id = crypto.randomUUID()
          tabs = [...tabs, { id, loc, back: [], forward: [] }]
          activeTabId = id
        } else if (!sameLoc(active.loc, loc)) {
          tabs = tabs.map(t =>
            t.id === activeTabId
              ? { ...t, loc, back: [...t.back.slice(-49), t.loc], forward: [] }
              : t,
          )
        }
        return {
          tabs,
          activeTabId,
          view: loc.view,
          ...(loc.pageId ? { activePageId: loc.pageId } : {}),
        }
      }

      const applyLoc = (loc: NavLoc): Partial<AreteState> => ({
        view: loc.view,
        ...(loc.pageId ? { activePageId: loc.pageId } : {}),
      })

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
        view: 'page',
        flash: null,
        restoreNonce: 0,
        tabs: [],
        activeTabId: null,
        peekPageId: null,

        setView: view =>
          set(s => ({ ...navigate(s, { view, pageId: s.activePageId }), searchOpen: false })),

        flashRefs: (cardId, pageId) => {
          if (!get().pages[pageId]) return
          set(s => ({
            ...navigate(s, { view: 'page', pageId }),
            searchOpen: false,
            flash: { cardId, pageId },
          }))
        },

        clearFlash: () => set({ flash: null }),

        goBack: () =>
          set(s => {
            const tab = s.tabs.find(t => t.id === s.activeTabId)
            if (!tab || !tab.back.length) return s
            const prev = tab.back[tab.back.length - 1]
            return {
              tabs: s.tabs.map(t =>
                t.id === tab.id
                  ? { ...t, loc: prev, back: t.back.slice(0, -1), forward: [...t.forward, t.loc] }
                  : t,
              ),
              ...applyLoc(prev),
              searchOpen: false,
            }
          }),

        goForward: () =>
          set(s => {
            const tab = s.tabs.find(t => t.id === s.activeTabId)
            if (!tab || !tab.forward.length) return s
            const next = tab.forward[tab.forward.length - 1]
            return {
              tabs: s.tabs.map(t =>
                t.id === tab.id
                  ? { ...t, loc: next, forward: t.forward.slice(0, -1), back: [...t.back, t.loc] }
                  : t,
              ),
              ...applyLoc(next),
              searchOpen: false,
            }
          }),

        newTab: loc =>
          set(s => {
            const l: NavLoc = loc ?? { view: s.view, pageId: s.activePageId }
            const tab: Tab = { id: crypto.randomUUID(), loc: l, back: [], forward: [] }
            return {
              tabs: [...s.tabs, tab],
              activeTabId: tab.id,
              ...applyLoc(l),
              searchOpen: false,
            }
          }),

        closeTab: id =>
          set(s => {
            const idx = s.tabs.findIndex(t => t.id === id)
            if (idx === -1 || s.tabs.length <= 1) return s
            const tabs = s.tabs.filter(t => t.id !== id)
            if (id !== s.activeTabId) return { tabs }
            const next = tabs[Math.min(idx, tabs.length - 1)]
            return { tabs, activeTabId: next.id, ...applyLoc(next.loc) }
          }),

        activateTab: id =>
          set(s => {
            const tab = s.tabs.find(t => t.id === id)
            if (!tab) return s
            return { activeTabId: id, ...applyLoc(tab.loc), searchOpen: false }
          }),

        ensureTabs: () =>
          set(s => {
            if (s.tabs.length && s.tabs.some(t => t.id === s.activeTabId)) return s
            const tab: Tab = {
              id: crypto.randomUUID(),
              loc: { view: s.view, pageId: s.activePageId },
              back: [],
              forward: [],
            }
            return { tabs: s.tabs.length ? s.tabs : [tab], activeTabId: s.tabs[0]?.id ?? tab.id }
          }),

        restorePage: (id, version) => {
          const page = get().pages[id]
          if (!page) return
          recordPageVersion(page, 'pre-restore')
          const restored: Page = {
            ...page,
            title: version.title,
            icon: version.icon,
            content: version.content,
            updatedAt: Date.now(),
          }
          set(s => ({
            pages: { ...s.pages, [id]: restored },
            restoreNonce: s.restoreNonce + 1,
          }))
          recordPageVersion(restored, 'restore')
        },

        openPage: (id, opts) => {
          if (!get().pages[id]) return
          set(s => ({
            ...navigate(s, { view: 'page', pageId: id }),
            searchOpen: false,
            pendingFocusId: opts?.focusTitle ? id : null,
          }))
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
                : {
                    ...navigate({ ...s, pages: { ...s.pages, [id]: page } }, { view: 'page', pageId: id }),
                    pendingFocusId: id,
                    searchOpen: false,
                  }),
              ...(parentId ? { expanded: { ...s.expanded, ['main:' + parentId]: true } } : {}),
            }
          })
          const created = get().pages[id]
          recordPageVersion(created, 'create')
          appendEvent({ kind: 'page-create', label: created.title || 'Untitled', pageId: id })
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
          appendEvent({ kind: 'page-delete', label: s.pages[id].title || 'Untitled', pageId: id })
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
          // Tabs pointing at deleted pages fall back; dead history entries drop.
          const fallback: NavLoc = { view: 'page', pageId: activePageId }
          const alive = (loc: NavLoc) => !(loc.pageId && ids.has(loc.pageId))
          const tabs = s.tabs.map(t => ({
            ...t,
            loc: alive(t.loc) ? t.loc : fallback,
            back: t.back.filter(alive),
            forward: t.forward.filter(alive),
          }))
          set({
            pages,
            favorites,
            expanded,
            activePageId,
            tabs,
            ...(s.peekPageId && ids.has(s.peekPageId) ? { peekPageId: null } : {}),
          })
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
          let restoreBump = false
          if (oldParent !== newParent) {
            childrenOf(pages, oldParent).forEach((p, i) => {
              pages[p.id] = { ...pages[p.id], order: i }
            })
            // The page's block follows it (like Notion): drop the owner link
            // from the old parent, append one at the bottom of the new parent
            // (unless the new parent is a database — rows carry no blocks).
            if (oldParent && pages[oldParent]?.content) {
              const res = stripOwnedLink(pages[oldParent].content!, id)
              if (res.removed) {
                const content = res.content.content?.length
                  ? res.content
                  : { type: 'doc', content: [{ type: 'paragraph' }] }
                pages[oldParent] = { ...pages[oldParent], content, updatedAt: Date.now() }
                if (s.activePageId === oldParent) restoreBump = true
              }
            }
            if (newParent && pages[newParent] && !pages[newParent].db) {
              const c = pages[newParent].content ?? { type: 'doc', content: [] }
              if (!hasPageLink(c, id)) {
                pages[newParent] = {
                  ...pages[newParent],
                  content: {
                    ...c,
                    content: [
                      ...(c.content ?? []),
                      { type: 'pageLink', attrs: { pageId: id, owner: true } },
                    ],
                  },
                  updatedAt: Date.now(),
                }
                if (s.activePageId === newParent) restoreBump = true
              }
            }
          }

          set({
            pages,
            // Open editors don't watch store content — remount the active one
            // when its doc just changed under it.
            ...(restoreBump ? { restoreNonce: s.restoreNonce + 1 } : {}),
            ...(spot.type === 'inside'
              ? { expanded: { ...s.expanded, ['main:' + spot.id]: true } }
              : {}),
          })
        },

        // ----- databases -----

        createDatabase: ({ parentId, title }) => {
          const id = get().createPage({ parentId, title: title ?? '', navigate: false })
          set(s => ({ pages: { ...s.pages, [id]: { ...s.pages[id], db: createDatabaseDef() } } }))
          // A fresh table starts with three empty rows, like Notion.
          for (let i = 0; i < 3; i++) get().dbAddRow(id)
          return id
        },

        dbUpdate: (dbId, fn) =>
          patch(dbId, p => (p.db ? { ...p, db: fn(p.db), updatedAt: Date.now() } : p)),

        dbUpdateView: (dbId, viewId, viewPatch) =>
          get().dbUpdate(dbId, db => ({
            ...db,
            views: db.views.map(v => (v.id === viewId ? { ...v, ...viewPatch } : v)),
          })),

        dbSetColumnMeta: (dbId, viewId, fieldId, metaPatch) =>
          get().dbUpdate(dbId, db => ({
            ...db,
            views: db.views.map(v =>
              v.id === viewId
                ? {
                    ...v,
                    columnMeta: {
                      ...v.columnMeta,
                      [fieldId]: { ...v.columnMeta[fieldId], ...metaPatch },
                    },
                  }
                : v,
            ),
          })),

        dbAddField: (dbId, type, opts) => {
          const fieldId = crypto.randomUUID()
          get().dbUpdate(dbId, db => {
            const field = {
              id: fieldId,
              name: defaultFieldName(type, db.fields),
              type,
              config: type === 'select' || type === 'multiSelect' ? { options: [] } : {},
            }
            const views = db.views.map(v => {
              const order = [...v.fieldOrder]
              const anchor = opts?.beforeId ?? opts?.afterId
              const at = anchor ? order.indexOf(anchor) : -1
              if (at === -1) order.push(fieldId)
              else order.splice(opts?.beforeId ? at : at + 1, 0, fieldId)
              return { ...v, fieldOrder: order }
            })
            return { ...db, fields: [...db.fields, field], views }
          })
          return fieldId
        },

        dbChangeFieldType: (dbId, fieldId, toType) => {
          const s = get()
          const dbPage = s.pages[dbId]
          const field = dbPage?.db?.fields.find(f => f.id === fieldId)
          if (!dbPage?.db || !field || field.type === 'title' || toType === field.type) return
          const rows = childrenOf(s.pages, dbId)
          const { field: next, values } = changeFieldType(field, toType, rows)
          const pages = { ...s.pages }
          pages[dbId] = {
            ...dbPage,
            db: { ...dbPage.db, fields: dbPage.db.fields.map(f => (f.id === fieldId ? next : f)) },
            updatedAt: Date.now(),
          }
          for (const row of rows) {
            const v = values.get(row.id) ?? null
            const props = { ...row.props }
            if (v === null) delete props[fieldId]
            else props[fieldId] = v
            pages[row.id] = { ...row, props }
          }
          set({ pages })
        },

        dbDuplicateField: (dbId, fieldId) => {
          const s = get()
          const dbPage = s.pages[dbId]
          const field = dbPage?.db?.fields.find(f => f.id === fieldId)
          if (!dbPage?.db || !field || field.type === 'title') return
          const copy = {
            ...field,
            id: crypto.randomUUID(),
            name: field.name + ' copy',
            config: { ...field.config, options: field.config.options?.map(o => ({ ...o })) },
          }
          const pages = { ...s.pages }
          pages[dbId] = {
            ...dbPage,
            db: {
              ...dbPage.db,
              fields: [...dbPage.db.fields, copy],
              views: dbPage.db.views.map(v => {
                const order = [...v.fieldOrder]
                const at = order.indexOf(fieldId)
                order.splice(at === -1 ? order.length : at + 1, 0, copy.id)
                return {
                  ...v,
                  fieldOrder: order,
                  columnMeta: v.columnMeta[fieldId]
                    ? { ...v.columnMeta, [copy.id]: { ...v.columnMeta[fieldId] } }
                    : v.columnMeta,
                }
              }),
            },
            updatedAt: Date.now(),
          }
          for (const row of childrenOf(s.pages, dbId)) {
            if (row.props && fieldId in row.props) {
              pages[row.id] = { ...row, props: { ...row.props, [copy.id]: row.props[fieldId] } }
            }
          }
          set({ pages })
        },

        dbRemoveField: (dbId, fieldId) => {
          const s = get()
          const dbPage = s.pages[dbId]
          const field = dbPage?.db?.fields.find(f => f.id === fieldId)
          if (!dbPage?.db || !field || field.type === 'title') return
          const prune = (n: FilterNode): FilterNode => ({
            ...n,
            children: n.children
              .filter(c => ('fieldId' in c ? c.fieldId !== fieldId : true))
              .map(c => ('conjunction' in c ? prune(c) : c)),
          })
          const pages = { ...s.pages }
          pages[dbId] = {
            ...dbPage,
            db: {
              ...dbPage.db,
              fields: dbPage.db.fields.filter(f => f.id !== fieldId),
              views: dbPage.db.views.map(v => {
                const { [fieldId]: _gone, ...meta } = v.columnMeta
                return {
                  ...v,
                  fieldOrder: v.fieldOrder.filter(id => id !== fieldId),
                  sorts: v.sorts.filter(x => x.fieldId !== fieldId),
                  filter: v.filter ? prune(v.filter) : null,
                  columnMeta: meta,
                }
              }),
            },
            updatedAt: Date.now(),
          }
          for (const row of childrenOf(s.pages, dbId)) {
            if (row.props && fieldId in row.props) {
              const { [fieldId]: _v, ...props } = row.props
              pages[row.id] = { ...row, props }
            }
          }
          set({ pages })
        },

        dbAddRow: (dbId, opts) => {
          const id = get().createPage({ parentId: dbId, navigate: false })
          set(s => ({ pages: { ...s.pages, [id]: { ...s.pages[id], props: {} } } }))
          if (opts?.afterId) get().movePage(id, { type: 'after', id: opts.afterId })
          return id
        },

        dbDeleteRows: ids => {
          for (const id of ids) get().deletePage(id)
        },

        dbSetCell: (rowId, fieldId, value) =>
          patch(rowId, p => {
            const props = { ...p.props }
            if (value === null || value === undefined) delete props[fieldId]
            else props[fieldId] = value
            return { ...p, props, updatedAt: Date.now() }
          }),

        toggleExpand: key => set(s => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } })),
        toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
        toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
        setSearchOpen: open => {
          if (!open) pagePick.current = null
          set({ searchOpen: open })
        },
        clearPendingFocus: () => set({ pendingFocusId: null }),
        setPeek: pageId => set(s => (s.pages[pageId ?? ''] || pageId === null ? { peekPageId: pageId } : s)),
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
        tabs: s.tabs,
        activeTabId: s.activeTabId,
      }),
    },
  ),
)
