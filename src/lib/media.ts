import { useEffect, useState } from 'react'
import { sanitizeFilename } from './markdown'

/**
 * Media files (images, embedded HTML) live as blobs in IndexedDB so they
 * work with or without a vault; when a vault is connected they mirror to a
 * `media/` folder as `<id>__<name>` files (the id prefix keys the round
 * trip). Blobs are immutable once saved — an id never changes content.
 */

export interface MediaRecord {
  id: string
  name: string
  type: string
  blob: Blob
}

const DB_NAME = 'arete-media'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const newMediaId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8)

export function mediaFilename(rec: Pick<MediaRecord, 'id' | 'name'>): string {
  return `${rec.id}__${sanitizeFilename(rec.name) || 'file'}`
}

/** `<id8>__<name>` → parts, or null for foreign files. */
export function parseMediaFilename(filename: string): { id: string; name: string } | null {
  const m = /^([0-9a-f]{8})__(.+)$/.exec(filename)
  return m ? { id: m[1], name: m[2] } : null
}

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
    ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff',
    html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8',
  }
  return map[ext] ?? 'application/octet-stream'
}

export const isHtmlName = (name: string) => /\.html?$/i.test(name)

export async function saveMedia(blob: Blob, name: string): Promise<MediaRecord> {
  // Blob URLs default to latin-1 without an explicit charset — HTML files
  // must carry utf-8 or their em-dashes turn to mojibake in the iframe.
  const type = isHtmlName(name) ? mimeFromName(name) : blob.type || mimeFromName(name)
  const rec: MediaRecord = {
    id: newMediaId(),
    name: name || 'file',
    type,
    blob: blob.type === type ? blob : new Blob([blob], { type }),
  }
  await tx('readwrite', s => s.put(rec))
  return rec
}

/** Import with a KNOWN id (vault load). No-op if already present. */
export async function importMedia(id: string, name: string, bytes: Uint8Array): Promise<void> {
  const existing = await getMedia(id)
  if (existing) return
  const type = mimeFromName(name)
  await tx('readwrite', s =>
    s.put({ id, name, type, blob: new Blob([bytes as BlobPart], { type }) }),
  )
}

export async function getMedia(id: string): Promise<MediaRecord | undefined> {
  return tx<MediaRecord | undefined>('readonly', s => s.get(id) as IDBRequest<MediaRecord | undefined>)
}

export async function listMedia(): Promise<MediaRecord[]> {
  return tx<MediaRecord[]>('readonly', s => s.getAll() as IDBRequest<MediaRecord[]>)
}

export async function deleteMedia(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id))
  const url = urlCache.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

// ----- object-URL cache ------------------------------------------------------

const urlCache = new Map<string, string>()

export async function getMediaURL(id: string): Promise<string | null> {
  const hit = urlCache.get(id)
  if (hit) return hit
  const rec = await getMedia(id)
  if (!rec) return null
  const url = URL.createObjectURL(rec.blob)
  urlCache.set(id, url)
  return url
}

/** React hook: object URL for a media id (null while loading / missing). */
export function useMediaURL(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(id ? urlCache.get(id) ?? null : null)
  useEffect(() => {
    let alive = true
    if (!id) {
      setUrl(null)
      return
    }
    void getMediaURL(id).then(u => {
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [id])
  return url
}
