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
  fs: FolderFS,
  dir: string[],
  parentId: string | null,
  out: RawFile[],
): Promise<void> {
  const entries = await fs.list(dir)
  const mdFiles = entries.filter(e => !e.dir && e.name.endsWith('.md') && !e.name.startsWith('.'))
  const dirs = entries.filter(e => e.dir && !e.name.startsWith('.'))

  let idx = 0
  const idsByBase = new Map<string, string>()
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

  for (const sub of dirs) {
    let owner = idsByBase.get(sub.name)
    if (!owner) {
      // Folder without a matching page file — represent it as a plain page.
      owner = crypto.randomUUID()
      out.push({ id: owner, title: sub.name, parentId, meta: {}, body: '', order: idx++ })
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
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // images: dropped
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
  fs: FolderFS,
  dir: string[],
  parentKey: string | null,
  out: NotionFile[],
): Promise<void> {
  const entries = await fs.list(dir)
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.dir && /\.(md|csv)$/.test(entry.name)) {
      const kind = entry.name.endsWith('.md') ? 'md' : 'csv'
      const base = stripNotionName(entry.name.replace(/\.(md|csv)$/, '').replace(/_all$/, ''))
      const text = (await fs.read([...dir, entry.name])) ?? ''
      out.push({ title: base, parentKey, key: [...dir, entry.name].join('/'), kind, text })
    } else if (entry.dir) {
      dirs.push(entry.name)
    }
  }
  for (const name of dirs) {
    const base = stripNotionName(name)
    // A folder's pages belong to the page whose file shares its name.
    const owner = out.find(f => f.parentKey === parentKey && f.title === base)
    await collectNotion(fs, [...dir, name], owner ? owner.key : parentKey, out)
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
        content: [{ type: 'text', text: `Imported Notion database (${header.join(', ')})` }],
      },
      ...(items.length ? [{ type: 'bulletList', content: items }] : []),
    ],
  }
}

/** Import an unzipped Notion export folder as a new page subtree.
 * Resolves null when the user cancels the picker. */
export async function importNotionExport(): Promise<{ pages: number } | { error: string } | null> {
  const picked = await pickFolderWithPath()
  if (!picked) return null
  const files: NotionFile[] = []
  await collectNotion(picked.fs, [], null, files)
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
