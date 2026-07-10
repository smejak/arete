import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import type { Page } from '../store/types'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { subscribeHistory } from './history'
import {
  docToMarkdown,
  markdownToDoc,
  pageToMarkdown,
  sanitizeFilename,
} from './markdown'
import { childrenOf, type Pages } from './tree'

/**
 * Folder vaults, the Obsidian way: the user picks a folder, every page lives
 * there as a plain markdown file (folders = hierarchy), and cards, review
 * logs, and history live in a hidden `.arete/` subfolder. Data never leaves
 * the device. Built on the File System Access API (Chrome/Edge; the same
 * layer maps 1:1 onto a desktop shell later). While connected, the vault is
 * the durable copy: every change mirrors to disk; the app re-reads the
 * folder on launch, so external edits to the markdown are picked up.
 */

type DirHandle = FileSystemDirectoryHandle

export interface VaultStatus {
  supported: boolean
  connected: boolean
  name: string | null
  /** 'permission' = a remembered vault exists but needs a click to re-grant. */
  state: 'idle' | 'syncing' | 'error' | 'permission'
  lastSync: number | null
  error: string | null
}

export const useVault = create<VaultStatus>(() => ({
  supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  connected: false,
  name: null,
  state: 'idle',
  lastSync: null,
  error: null,
}))

let root: DirHandle | null = null
let fileCache = new Map<string, string>()
let syncTimer: number | null = null
let hydrating = false
let subscribed = false

// ---------------------------------------------------------------------------
// IndexedDB slot for the directory handle (survives reloads)
// ---------------------------------------------------------------------------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('arete-vault', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown) {
  const db = await idb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(key: string) {
  const db = await idb()
  await new Promise<void>(resolve => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** File path (segments) for every page: roots at the top, children inside a
 * folder named like their parent's file. Duplicate titles get " 2", " 3"… */
function computePaths(pages: Pages): Map<string, string[]> {
  const paths = new Map<string, string[]>()
  const walk = (parentId: string | null, prefix: string[]) => {
    const used = new Set<string>()
    for (const page of childrenOf(pages, parentId)) {
      let base = sanitizeFilename(page.title || 'Untitled')
      let candidate = base
      let n = 2
      while (used.has(candidate.toLowerCase())) candidate = `${base} ${n++}`
      used.add(candidate.toLowerCase())
      paths.set(page.id, [...prefix, candidate])
      walk(page.id, [...prefix, candidate])
    }
  }
  walk(null, [])
  return paths
}

async function getDir(segments: string[], createDirs: boolean): Promise<DirHandle | null> {
  if (!root) return null
  let dir: DirHandle = root
  for (const seg of segments) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create: createDirs })
    } catch {
      return null
    }
  }
  return dir
}

async function writePath(path: string, contents: string) {
  const segments = path.split('/')
  const name = segments.pop()!
  const dir = await getDir(segments, true)
  if (!dir) throw new Error('vault directory unavailable: ' + path)
  const file = await dir.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  await writable.write(contents)
  await writable.close()
}

async function deletePath(path: string) {
  const segments = path.split('/')
  const name = segments.pop()!
  const dir = await getDir(segments, false)
  if (!dir) return
  try {
    await dir.removeEntry(name)
  } catch {
    /* already gone */
  }
}

async function pruneEmptyDirs(dir: DirHandle, isRoot: boolean): Promise<boolean> {
  let hasEntries = false
  const subdirs: { name: string; handle: DirHandle }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === 'directory' && name !== '.arete') {
      subdirs.push({ name, handle: handle as DirHandle })
    } else {
      hasEntries = true
    }
  }
  for (const sub of subdirs) {
    const empty = await pruneEmptyDirs(sub.handle, false)
    if (empty) {
      try {
        await dir.removeEntry(sub.name)
      } catch {
        hasEntries = true
      }
    } else {
      hasEntries = true
    }
  }
  return !isRoot && !hasEntries
}

// ---------------------------------------------------------------------------
// History dump (localStorage `arete.hist.*` ⇄ one vault file)
// ---------------------------------------------------------------------------

function dumpHistory(): string {
  const dump: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('arete.hist.')) {
      try {
        dump[key] = JSON.parse(localStorage.getItem(key) ?? 'null')
      } catch {
        /* skip */
      }
    }
  }
  return JSON.stringify(dump)
}

function restoreHistory(json: string | null) {
  if (!json) return
  try {
    const dump = JSON.parse(json) as Record<string, unknown>
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('arete.hist.')) stale.push(key)
    }
    stale.forEach(k => localStorage.removeItem(k))
    for (const [key, value] of Object.entries(dump)) {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Sync out (app → folder)
// ---------------------------------------------------------------------------

export function scheduleVaultSync() {
  if (!root || hydrating) return
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    void runSync()
  }, 1500)
}

async function runSync() {
  if (!root || hydrating) return
  useVault.setState({ state: 'syncing' })
  try {
    const pagesState = useStore.getState()
    const srs = useSrsStore.getState()
    const pages = pagesState.pages
    const titleOf = (id: string) => (pages[id] ? pages[id].title || 'Untitled' : null)
    const paths = computePaths(pages)

    const desired = new Map<string, string>()
    for (const [id, segments] of paths) {
      desired.set(segments.join('/') + '.md', pageToMarkdown(pages[id], titleOf))
    }
    desired.set('.arete/cards.json', JSON.stringify(srs.cards, null, 2))
    desired.set('.arete/logs.json', JSON.stringify(srs.logs))
    desired.set('.arete/history.json', dumpHistory())
    desired.set(
      '.arete/meta.json',
      JSON.stringify({ version: 1, favorites: pagesState.favorites, theme: pagesState.theme }, null, 2),
    )

    for (const [path, contents] of desired) {
      if (fileCache.get(path) !== contents) {
        await writePath(path, contents)
        fileCache.set(path, contents)
      }
    }
    for (const path of [...fileCache.keys()]) {
      if (!desired.has(path)) {
        await deletePath(path)
        fileCache.delete(path)
      }
    }
    await pruneEmptyDirs(root, true)
    useVault.setState({ state: 'idle', lastSync: Date.now(), error: null })
  } catch (err) {
    useVault.setState({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

function subscribeStores() {
  if (subscribed) return
  subscribed = true
  useStore.subscribe(scheduleVaultSync)
  useSrsStore.subscribe(scheduleVaultSync)
  subscribeHistory(scheduleVaultSync)
}

// ---------------------------------------------------------------------------
// Load (folder → app)
// ---------------------------------------------------------------------------

interface RawFile {
  id: string
  title: string
  parentId: string | null
  meta: Record<string, string>
  body: string
  order: number
}

async function collectVaultFiles(
  dir: DirHandle,
  parentId: string | null,
  out: RawFile[],
): Promise<void> {
  const files = new Map<string, string>() // base name -> raw md
  const dirs = new Map<string, DirHandle>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (name.startsWith('.')) continue
    if (handle.kind === 'file' && name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      files.set(name.slice(0, -3), await file.text())
    } else if (handle.kind === 'directory') {
      dirs.set(name, handle as DirHandle)
    }
  }

  let idx = 0
  const idsByBase = new Map<string, string>()
  for (const [base, raw] of files) {
    const meta: Record<string, string> = {}
    const lines = raw.split('\n')
    if (lines[0] === '---') {
      for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
        const m = /^([A-Za-z-]+):\s*(.*)$/.exec(lines[i])
        if (m) meta[m[1]] = m[2]
      }
    }
    const id = meta['arete-id'] || crypto.randomUUID()
    idsByBase.set(base, id)
    out.push({
      id,
      title: base,
      parentId,
      meta,
      body: raw,
      order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : idx,
    })
    idx++
  }

  for (const [name, sub] of dirs) {
    let owner = idsByBase.get(name)
    if (!owner) {
      // Folder without a matching page file — represent it as a plain page.
      owner = crypto.randomUUID()
      out.push({ id: owner, title: name, parentId, meta: {}, body: '', order: idx++ })
    }
    await collectVaultFiles(sub, owner, out)
  }
}

async function loadVault(dir: DirHandle) {
  hydrating = true
  try {
    const raw: RawFile[] = []
    await collectVaultFiles(dir, null, raw)

    const titleToId = new Map<string, string>()
    for (const file of raw) {
      const key = file.title.toLowerCase()
      if (!titleToId.has(key)) titleToId.set(key, file.id)
    }
    const resolve = (title: string) => titleToId.get(title.toLowerCase()) ?? null

    const pages: Record<string, Page> = {}
    for (const file of raw) {
      const parsed = markdownToDoc(file.body, resolve)
      const meta = { ...parsed.meta, ...file.meta }
      pages[file.id] = {
        id: file.id,
        title: file.title === 'Untitled' ? '' : file.title,
        icon: meta.icon || null,
        cover: meta.cover || null,
        parentId: file.parentId,
        order: file.order,
        font: meta.font === 'serif' || meta.font === 'mono' ? meta.font : 'sans',
        content: parsed.content,
        createdAt: meta.created ? Date.parse(meta.created) || Date.now() : Date.now(),
        updatedAt: meta.updated ? Date.parse(meta.updated) || Date.now() : Date.now(),
      }
    }

    const readJson = async <T>(name: string): Promise<T | null> => {
      try {
        const areteDir = await dir.getDirectoryHandle('.arete')
        const fh = await areteDir.getFileHandle(name)
        return JSON.parse(await (await fh.getFile()).text()) as T
      } catch {
        return null
      }
    }

    const cards = (await readJson<Record<string, never>>('cards.json')) ?? {}
    const logs = (await readJson<never[]>('logs.json')) ?? []
    const meta = await readJson<{ favorites?: string[] }>('meta.json')
    const historyDump = await (async () => {
      try {
        const areteDir = await dir.getDirectoryHandle('.arete')
        const fh = await areteDir.getFileHandle('history.json')
        return await (await fh.getFile()).text()
      } catch {
        return null
      }
    })()

    if (Object.keys(pages).length === 0) {
      // Empty folder: nothing to load — caller seeds instead.
      hydrating = false
      return false
    }

    restoreHistory(historyDump)
    const firstRoot = childrenOf(pages, null)[0]?.id ?? null
    useStore.setState({
      pages,
      favorites: (meta?.favorites ?? []).filter(id => pages[id]),
      activePageId: firstRoot,
      expanded: {},
      tabs: [],
      activeTabId: null,
      view: 'page',
      flash: null,
    })
    useStore.getState().ensureTabs()
    useSrsStore.setState({ cards, logs })
    return true
  } finally {
    hydrating = false
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function attach(dir: DirHandle) {
  root = dir
  fileCache = new Map()
  await idbSet('handle', dir)
  useVault.setState({ connected: true, name: dir.name, state: 'idle', error: null })
  subscribeStores()
}

/** Seed a folder from the current workspace ("Create vault"). */
export async function createVaultFromWorkspace(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dir: DirHandle = await (window as any).showDirectoryPicker({ id: 'arete-vault', mode: 'readwrite' })
  try {
    await dir.getDirectoryHandle('.arete')
    return 'That folder already contains a vault — use “Open existing vault” instead.'
  } catch {
    /* good: fresh folder */
  }
  await attach(dir)
  await runSync()
  return null
}

/** Open a folder that already is a vault (or plain markdown) — replaces the
 * current in-app workspace with the folder's contents. */
export async function openVault(): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dir: DirHandle = await (window as any).showDirectoryPicker({ id: 'arete-vault', mode: 'readwrite' })
  await attach(dir)
  const loaded = await loadVault(dir)
  if (!loaded) {
    await runSync() // empty folder: behave like "create"
    return null
  }
  await runSync()
  return null
}

export async function disconnectVault() {
  root = null
  fileCache = new Map()
  await idbDelete('handle')
  useVault.setState({ connected: false, name: null, state: 'idle', error: null })
}

/** On boot: re-attach a remembered vault if permission is still granted. */
export async function tryRestoreVault() {
  if (!useVault.getState().supported) return
  const handle = await idbGet<DirHandle>('handle').catch(() => undefined)
  if (!handle) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perm = await (handle as any).queryPermission?.({ mode: 'readwrite' })
  if (perm === 'granted') {
    await attach(handle)
    await loadVault(handle)
    await runSync()
  } else {
    useVault.setState({ name: handle.name, state: 'permission' })
  }
}

/** Permission re-grant needs a user gesture — called from the Reconnect button. */
export async function reconnectVault(): Promise<boolean> {
  const handle = await idbGet<DirHandle>('handle').catch(() => undefined)
  if (!handle) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perm = await (handle as any).requestPermission?.({ mode: 'readwrite' })
  if (perm !== 'granted') return false
  await attach(handle)
  await loadVault(handle)
  await runSync()
  return true
}

// ---------------------------------------------------------------------------
// Notion import
// ---------------------------------------------------------------------------

const NOTION_HASH = /\s+[0-9a-f]{32}$/i

function stripNotionName(name: string): string {
  return name.replace(NOTION_HASH, '').trim()
}

/** Rewrite Notion's relative markdown links into wikilinks before parsing. */
function preprocessNotionMd(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // images: dropped (kept local by Notion export)
    .replace(/\[([^\]]+)\]\(([^)]+\.md)\)/g, (_m, _text: string, target: string) => {
      const base = decodeURIComponent(target.split('/').pop()!.replace(/\.md$/, ''))
      return `[[${stripNotionName(base)}]]`
    })
    .replace(/\[([^\]]+)\]\(([^)]+\.csv)\)/g, (_m, text: string) => `[[${stripNotionName(text)}]]`)
}

interface NotionFile {
  title: string
  parentKey: string | null
  key: string
  kind: 'md' | 'csv'
  text: string
}

async function collectNotion(
  dir: DirHandle,
  parentKey: string | null,
  prefix: string,
  out: NotionFile[],
): Promise<void> {
  const dirs: { name: string; handle: DirHandle }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === 'file' && (name.endsWith('.md') || name.endsWith('.csv'))) {
      const kind = name.endsWith('.md') ? 'md' : 'csv'
      const base = stripNotionName(name.replace(/\.(md|csv)$/, '').replace(/_all$/, ''))
      const file = await (handle as FileSystemFileHandle).getFile()
      out.push({ title: base, parentKey, key: prefix + name, kind, text: await file.text() })
    } else if (handle.kind === 'directory') {
      dirs.push({ name, handle: handle as DirHandle })
    }
  }
  for (const { name, handle } of dirs) {
    const base = stripNotionName(name)
    // A folder's pages belong to the page whose file shares its name.
    const owner = out.find(f => f.parentKey === parentKey && f.title === base)
    await collectNotion(handle, owner ? owner.key : parentKey, prefix + name + '/', out)
  }
}

function csvToDoc(csv: string): JSONContent {
  const rows = csv.split('\n').filter(r => r.trim()).slice(0, 101)
  const header = rows[0]?.split(',') ?? []
  const items = rows.slice(1).map(row => {
    const cells = row.split(',')
    return {
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: cells[0] || '—', marks: [{ type: 'bold' }] },
            ...(cells.length > 1
              ? [{ type: 'text', text: '  ·  ' + cells.slice(1).join(' · ') }]
              : []),
          ],
        },
      ],
    }
  })
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Imported Notion database (${header.join(', ')})` }],
      },
      ...(items.length ? [{ type: 'bulletList', content: items }] : []),
    ],
  }
}

/** Import an unzipped Notion export folder as a new page subtree. */
export async function importNotionExport(): Promise<{ pages: number } | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dir: DirHandle = await (window as any).showDirectoryPicker({ id: 'notion-import', mode: 'read' })
  const files: NotionFile[] = []
  await collectNotion(dir, null, '', files)
  if (!files.length) return { error: 'No markdown or CSV files found in that folder.' }

  const now = Date.now()
  const rootId = crypto.randomUUID()
  const idByKey = new Map<string, string>()
  files.forEach(f => idByKey.set(f.key, crypto.randomUUID()))
  const titleToId = new Map<string, string>()
  files.forEach(f => {
    const key = f.title.toLowerCase()
    if (!titleToId.has(key)) titleToId.set(key, idByKey.get(f.key)!)
  })
  const resolve = (title: string) => titleToId.get(stripNotionName(title).toLowerCase()) ?? null

  const newPages: Record<string, Page> = {
    [rootId]: {
      id: rootId,
      title: 'Notion import',
      icon: '📥',
      cover: null,
      parentId: null,
      order: 999,
      font: 'sans',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `Imported ${files.length} page${files.length === 1 ? '' : 's'} from a Notion export on ${new Date().toLocaleDateString()}.`,
              },
            ],
          },
        ],
      },
      createdAt: now,
      updatedAt: now,
    },
  }

  const siblingsSeen = new Map<string, number>()
  for (const file of files) {
    const id = idByKey.get(file.key)!
    const parentId = file.parentKey ? idByKey.get(file.parentKey)! : rootId
    const order = siblingsSeen.get(parentId) ?? 0
    siblingsSeen.set(parentId, order + 1)
    const content =
      file.kind === 'csv'
        ? csvToDoc(file.text)
        : markdownToDoc(preprocessNotionMd(file.text), resolve).content
    newPages[id] = {
      id,
      title: file.title,
      icon: null,
      cover: null,
      parentId,
      order,
      font: 'sans',
      content,
      createdAt: now,
      updatedAt: now,
    }
  }

  useStore.setState(s => ({ pages: { ...s.pages, ...newPages } }))
  useStore.getState().openPage(rootId)
  scheduleVaultSync()
  return { pages: files.length }
}
