/**
 * One folder-filesystem interface, two engines:
 *
 * - Web: the File System Access API (Chrome/Edge), with the directory handle
 *   remembered in IndexedDB and permission re-grants on relaunch.
 * - Tauri: the native filesystem via @tauri-apps/plugin-fs, with the folder
 *   path remembered in localStorage — no permission dance.
 *
 * The vault layer is written against `FolderFS` only and never knows which
 * engine it is running on.
 */

export interface FolderFS {
  name: string
  kind: 'web' | 'tauri'
  read(path: string[]): Promise<string | null>
  write(path: string[], contents: string): Promise<void>
  remove(path: string[]): Promise<void>
  /** Entries of a directory; [] when it does not exist. */
  list(path: string[]): Promise<{ name: string; dir: boolean }[]>
  removeEmptyDir(path: string[]): Promise<void>
}

export const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const folderPickingSupported = (): boolean =>
  isTauriEnv() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window)

// ---------------------------------------------------------------------------
// Web engine (File System Access API)
// ---------------------------------------------------------------------------

type DirHandle = FileSystemDirectoryHandle

function webFS(root: DirHandle): FolderFS & { handle: DirHandle } {
  const getDir = async (segments: string[], create: boolean): Promise<DirHandle | null> => {
    let dir: DirHandle = root
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create })
      } catch {
        return null
      }
    }
    return dir
  }

  return {
    name: root.name,
    kind: 'web',
    handle: root,

    async read(path) {
      const segments = [...path]
      const name = segments.pop()!
      const dir = await getDir(segments, false)
      if (!dir) return null
      try {
        const fh = await dir.getFileHandle(name)
        return await (await fh.getFile()).text()
      } catch {
        return null
      }
    },

    async write(path, contents) {
      const segments = [...path]
      const name = segments.pop()!
      const dir = await getDir(segments, true)
      if (!dir) throw new Error('vault folder unavailable: ' + path.join('/'))
      const fh = await dir.getFileHandle(name, { create: true })
      const writable = await fh.createWritable()
      await writable.write(contents)
      await writable.close()
    },

    async remove(path) {
      const segments = [...path]
      const name = segments.pop()!
      const dir = await getDir(segments, false)
      if (!dir) return
      try {
        await dir.removeEntry(name)
      } catch {
        /* already gone */
      }
    },

    async list(path) {
      const dir = await getDir(path, false)
      if (!dir) return []
      const out: { name: string; dir: boolean }[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const [name, handle] of (dir as any).entries() as AsyncIterable<
        [string, FileSystemHandle]
      >) {
        out.push({ name, dir: handle.kind === 'directory' })
      }
      return out
    },

    async removeEmptyDir(path) {
      if (!path.length) return
      const entries = await this.list(path)
      if (entries.length) return
      await this.remove(path)
    },
  }
}

// -- IndexedDB slot for the web handle --------------------------------------

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
// Tauri engine (native fs)
// ---------------------------------------------------------------------------

const TAURI_PATH_KEY = 'arete-vault-path'

async function tauriFS(base: string): Promise<FolderFS> {
  const fs = await import('@tauri-apps/plugin-fs')
  const join = (path: string[]) => [base, ...path].join('/')
  const name = base.split('/').filter(Boolean).pop() ?? base

  const list = async (path: string[]): Promise<{ name: string; dir: boolean }[]> => {
    try {
      const entries = await fs.readDir(join(path))
      return entries.filter(e => e.name).map(e => ({ name: e.name, dir: !!e.isDirectory }))
    } catch {
      return []
    }
  }

  return {
    name,
    kind: 'tauri',

    async read(path) {
      try {
        return await fs.readTextFile(join(path))
      } catch {
        return null
      }
    },

    async write(path, contents) {
      const parent = path.slice(0, -1)
      if (parent.length) await fs.mkdir(join(parent), { recursive: true }).catch(() => {})
      await fs.writeTextFile(join(path), contents)
    },

    async remove(path) {
      try {
        await fs.remove(join(path))
      } catch {
        /* already gone */
      }
    },

    list,

    async removeEmptyDir(path) {
      if (!path.length) return
      const entries = await list(path)
      if (entries.length) return
      try {
        await fs.remove(join(path))
      } catch {
        /* not empty or gone */
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Picking, remembering, restoring
// ---------------------------------------------------------------------------

/** Open the platform folder picker. Resolves null when the user cancels. */
export async function pickFolder(): Promise<FolderFS | null> {
  if (isTauriEnv()) {
    const dialog = await import('@tauri-apps/plugin-dialog')
    const path = await dialog.open({ directory: true, multiple: false })
    if (typeof path !== 'string') return null
    return tauriFS(path)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle: DirHandle = await (window as any).showDirectoryPicker({
      id: 'arete-vault',
      mode: 'readwrite',
    })
    return webFS(handle)
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null
    throw err
  }
}

/** Remember a Tauri vault by absolute path (web vaults persist their handle). */
export async function persistVault(fs: FolderFS, tauriPath?: string) {
  if (fs.kind === 'tauri' && tauriPath) {
    localStorage.setItem(TAURI_PATH_KEY, tauriPath)
  } else if (fs.kind === 'web') {
    await idbSet('handle', (fs as ReturnType<typeof webFS>).handle)
  }
}

export async function forgetVault() {
  localStorage.removeItem(TAURI_PATH_KEY)
  await idbDelete('handle')
}

export type RestoreResult = { fs: FolderFS } | { permission: string } | null

/** Re-attach the remembered vault on launch, if possible without a prompt. */
export async function restoreVault(): Promise<RestoreResult> {
  if (isTauriEnv()) {
    const path = localStorage.getItem(TAURI_PATH_KEY)
    if (!path) return null
    const fs = await import('@tauri-apps/plugin-fs')
    const there = await fs.exists(path).catch(() => false)
    if (!there) return null
    return { fs: await tauriFS(path) }
  }
  const handle = await idbGet<DirHandle>('handle').catch(() => undefined)
  if (!handle) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perm = await (handle as any).queryPermission?.({ mode: 'readwrite' })
  if (perm === 'granted') return { fs: webFS(handle) }
  return { permission: handle.name }
}

/** Web only: permission re-grant requires a user gesture. */
export async function requestVaultPermission(): Promise<FolderFS | null> {
  const handle = await idbGet<DirHandle>('handle').catch(() => undefined)
  if (!handle) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perm = await (handle as any).requestPermission?.({ mode: 'readwrite' })
  if (perm !== 'granted') return null
  return webFS(handle)
}

/** The absolute path of a picked Tauri folder (needed for persistence). */
export async function pickFolderWithPath(): Promise<{ fs: FolderFS; tauriPath?: string } | null> {
  if (isTauriEnv()) {
    const dialog = await import('@tauri-apps/plugin-dialog')
    const path = await dialog.open({ directory: true, multiple: false })
    if (typeof path !== 'string') return null
    return { fs: await tauriFS(path), tauriPath: path }
  }
  const fs = await pickFolder()
  return fs ? { fs } : null
}
