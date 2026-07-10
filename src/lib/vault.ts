import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import type { Page } from '../store/types'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { subscribeHistory } from './history'
import {
  folderPickingSupported,
  forgetVault,
  pickFolderWithPath,
  requestVaultPermission,
  restoreVault,
  type FolderFS,
} from './fs-adapter'
import { markdownToDoc, pageToMarkdown, sanitizeFilename } from './markdown'
import { childrenOf, type Pages } from './tree'

/**
 * Folder vaults, the Obsidian way: the user picks a folder, every page lives
 * there as a plain markdown file (folders = hierarchy), and cards, review
 * logs, and history live in a hidden `.arete/` subfolder. Data never leaves
 * the device. Runs on the File System Access API in the browser and on the
 * native filesystem in the desktop app — same code, two engines. While
 * connected the vault is the durable copy: every change mirrors to disk, and
 * the folder is re-read on launch so external markdown edits are picked up.
 */

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
  supported: folderPickingSupported(),
  connected: false,
  name: null,
  state: 'idle',
  lastSync: null,
  error: null,
}))

let vaultFS: FolderFS | null = null
let fileCache = new Map<string, string>()
let syncTimer: number | null = null
let hydrating = false
let subscribed = false

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
      const base = sanitizeFilename(page.title || 'Untitled')
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

async function pruneEmptyDirs(fs: FolderFS, path: string[]): Promise<void> {
  const entries = await fs.list(path)
  for (const entry of entries) {
    if (entry.dir && entry.name !== '.arete' && !entry.name.startsWith('.')) {
      await pruneEmptyDirs(fs, [...path, entry.name])
    }
  }
  if (path.length) await fs.removeEmptyDir(path)
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
  if (!vaultFS || hydrating) return
  if (syncTimer) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    void runSync()
  }, 1500)
}

async function runSync() {
  const fs = vaultFS
  if (!fs || hydrating) return
  useVault.setState({ state: 'syncing' })
  try {
    const pagesState = useStore.getState()
    const srs = useSrsStore.getState()
    const pages = pagesState.pages
    const titleOf = (id: string) => (pages[id] ? pages[id].title || 'Untitled' : null)
    const paths = computePaths(pages)

    const desired = new Map<string, { segs: string[]; contents: string }>()
    const put = (segs: string[], contents: string) => desired.set(segs.join('/'), { segs, contents })
    for (const [id, segments] of paths) {
      put([...segments.slice(0, -1), segments[segments.length - 1] + '.md'], pageToMarkdown(pages[id], titleOf))
    }
    put(['.arete', 'cards.json'], JSON.stringify(srs.cards, null, 2))
    put(['.arete', 'logs.json'], JSON.stringify(srs.logs))
    put(['.arete', 'history.json'], dumpHistory())
    put(
      ['.arete', 'meta.json'],
      JSON.stringify({ version: 1, favorites: pagesState.favorites, theme: pagesState.theme }, null, 2),
    )

    for (const [key, file] of desired) {
      if (fileCache.get(key) !== file.contents) {
        await fs.write(file.segs, file.contents)
        fileCache.set(key, file.contents)
      }
    }
    for (const key of [...fileCache.keys()]) {
      if (!desired.has(key)) {
        await fs.remove(key.split('/'))
        fileCache.delete(key)
      }
    }
    await pruneEmptyDirs(fs, [])
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
//
// "Open existing vault" accepts more than our own output: any folder of
// markdown works, and unzipped Notion exports are recognized and normalized
// on the way in — 32-hex name hashes stripped, relative .md links rewritten
// to wikilinks, database CSVs turned into list pages. The first sync then
// writes everything back in clean Arete form.
// ---------------------------------------------------------------------------

const NOTION_HASH = /\s+[0-9a-f]{32}$/i

function stripNotionName(name: string): string {
  return name.replace(NOTION_HASH, '').trim()
}

/** Rewrite relative markdown-file links (Notion's link style) into wikilinks. */
function normalizeMd(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\(([^)]+\.md)\)/g, (_m, _text: string, target: string) => {
      const base = decodeURIComponent(target.split('/').pop()!.replace(/\.md$/, ''))
      return `[[${stripNotionName(base)}]]`
    })
    .replace(/\[([^\]]+)\]\(([^)]+\.csv)\)/g, (_m, text: string) => `[[${stripNotionName(text)}]]`)
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
            ...(cells.length > 1 ? [{ type: 'text', text: '  ·  ' + cells.slice(1).join(' · ') }] : []),
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
        content: [{ type: 'text', text: `Imported database (${header.join(', ')})` }],
      },
      ...(items.length ? [{ type: 'bulletList', content: items }] : []),
    ],
  }
}

interface RawFile {
  id: string
  title: string
  parentId: string | null
  meta: Record<string, string>
  body: string
  order: number
  csv: boolean
  /** Original on-disk path — becomes the sync cache seed so renames and
   * normalization replace files instead of duplicating them. */
  path: string[]
}

async function collectVaultFiles(
  fs: FolderFS,
  dir: string[],
  parentId: string | null,
  out: RawFile[],
): Promise<void> {
  const entries = await fs.list(dir)
  const mdFiles = entries.filter(e => !e.dir && e.name.endsWith('.md') && !e.name.startsWith('.'))
  const csvFiles = entries.filter(e => !e.dir && e.name.endsWith('.csv') && !e.name.startsWith('.'))
  const dirs = entries.filter(e => e.dir && !e.name.startsWith('.'))

  let idx = 0
  const idsByRawBase = new Map<string, string>()
  const titlesTaken = new Set<string>()
  for (const file of mdFiles) {
    const base = file.name.slice(0, -3)
    const raw = (await fs.read([...dir, file.name])) ?? ''
    const meta: Record<string, string> = {}
    const lines = raw.split('\n')
    if (lines[0] === '---') {
      for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
        const m = /^([A-Za-z-]+):\s*(.*)$/.exec(lines[i])
        if (m) meta[m[1]] = m[2]
      }
    }
    const id = meta['arete-id'] || crypto.randomUUID()
    const title = stripNotionName(base)
    idsByRawBase.set(base, id)
    titlesTaken.add(title.toLowerCase())
    out.push({
      id,
      title,
      parentId,
      meta,
      body: raw,
      order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : idx,
      csv: false,
      path: [...dir, file.name],
    })
    idx++
  }

  for (const file of csvFiles) {
    const base = stripNotionName(file.name.replace(/\.csv$/, '').replace(/_all$/, ''))
    // Skip when a page of the same name already exists here (e.g. our own
    // earlier conversion of this database).
    if (titlesTaken.has(base.toLowerCase())) continue
    const raw = (await fs.read([...dir, file.name])) ?? ''
    out.push({
      id: 'csv:' + [...dir, file.name].join('/'), // stable across launches
      title: base,
      parentId,
      meta: {},
      body: raw,
      order: idx++,
      csv: true,
      path: [...dir, file.name],
    })
  }

  for (const sub of dirs) {
    let owner = idsByRawBase.get(sub.name)
    if (!owner) {
      // Notion folders pair with a hashed page file of the same stripped name.
      const stripped = stripNotionName(sub.name)
      const match = out.find(f => f.parentId === parentId && f.title === stripped && !f.csv)
      owner = match?.id
    }
    if (!owner) {
      // Folder without a matching page file — represent it as a plain page.
      owner = crypto.randomUUID()
      out.push({
        id: owner,
        title: stripNotionName(sub.name),
        parentId,
        meta: {},
        body: '',
        order: idx++,
        csv: false,
        path: [],
      })
    }
    await collectVaultFiles(fs, [...dir, sub.name], owner, out)
  }
}

async function loadVault(fs: FolderFS): Promise<boolean> {
  hydrating = true
  try {
    const raw: RawFile[] = []
    await collectVaultFiles(fs, [], null, raw)

    if (raw.length === 0) return false // empty folder — caller seeds instead

    const titleToId = new Map<string, string>()
    for (const file of raw) {
      const key = stripNotionName(file.title).toLowerCase()
      if (!titleToId.has(key)) titleToId.set(key, file.id)
    }
    const resolve = (title: string) =>
      titleToId.get(stripNotionName(title).toLowerCase()) ?? null

    const pages: Record<string, Page> = {}
    for (const file of raw) {
      const parsed = file.csv
        ? { meta: {} as Record<string, string>, content: csvToDoc(file.body) }
        : markdownToDoc(normalizeMd(file.body), resolve)
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

    // Seed the sync cache with the files as found on disk, so the first sync
    // renames and normalizes in place instead of leaving stale copies behind.
    // (CSV originals are deliberately not seeded: they stay untouched on disk
    // and their pages regenerate from them.)
    fileCache = new Map()
    for (const file of raw) {
      if (file.path.length && !file.csv) fileCache.set(file.path.join('/'), file.body)
    }

    const readJson = async <T>(name: string): Promise<T | null> => {
      const text = await fs.read(['.arete', name])
      if (!text) return null
      try {
        return JSON.parse(text) as T
      } catch {
        return null
      }
    }

    const cards = (await readJson<Record<string, never>>('cards.json')) ?? {}
    const logs = (await readJson<never[]>('logs.json')) ?? []
    const meta = await readJson<{ favorites?: string[] }>('meta.json')
    restoreHistory(await fs.read(['.arete', 'history.json']))

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

async function attach(fs: FolderFS, tauriPath?: string) {
  vaultFS = fs
  fileCache = new Map()
  const { persistVault } = await import('./fs-adapter')
  await persistVault(fs, tauriPath)
  useVault.setState({ connected: true, name: fs.name, state: 'idle', error: null })
  subscribeStores()
}

/** Seed a folder from the current workspace ("Create vault"). */
export async function createVaultFromWorkspace(): Promise<string | null> {
  const picked = await pickFolderWithPath()
  if (!picked) return null // cancelled
  const existing = await picked.fs.list(['.arete'])
  if (existing.length > 0) {
    return 'That folder already contains a vault — use “Open existing vault” instead.'
  }
  await attach(picked.fs, picked.tauriPath)
  await runSync()
  return null
}

/** Open a folder that already is a vault (or plain markdown) — replaces the
 * current in-app workspace with the folder's contents. */
export async function openVault(): Promise<string | null> {
  const picked = await pickFolderWithPath()
  if (!picked) return null // cancelled
  await attach(picked.fs, picked.tauriPath)
  const loaded = await loadVault(picked.fs)
  await runSync() // empty folder behaves like "create"; loaded vaults write back normalized files
  return loaded ? null : 'Folder was empty — created a vault from the current workspace.'
}

export async function disconnectVault() {
  vaultFS = null
  fileCache = new Map()
  await forgetVault()
  useVault.setState({ connected: false, name: null, state: 'idle', error: null })
}

/** On boot: re-attach a remembered vault if possible without prompting. */
export async function tryRestoreVault() {
  if (!useVault.getState().supported) return
  const restored = await restoreVault().catch(() => null)
  if (!restored) return
  if ('permission' in restored) {
    useVault.setState({ name: restored.permission, state: 'permission' })
    return
  }
  await attach(restored.fs)
  await loadVault(restored.fs)
  await runSync()
}

/** Web only: permission re-grant needs a user gesture (Reconnect button). */
export async function reconnectVault(): Promise<boolean> {
  const fs = await requestVaultPermission()
  if (!fs) return false
  await attach(fs)
  await loadVault(fs)
  await runSync()
  return true
}
