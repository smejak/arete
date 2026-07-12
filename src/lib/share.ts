import { strToU8, zipSync } from 'fflate'
import type { SrsCard } from '../store/types'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { childrenOf, descendantsOf } from './tree'
import { pageToMarkdown, sanitizeFilename } from './markdown'
import { isTauriEnv } from './fs-adapter'

/**
 * Share a page as a zip of plain markdown — optionally with its subpages and
 * with the flashcards that belong to (or reference) those pages. The zip is a
 * miniature vault: unzip it and "Switch folder" onto it restores pages *and*
 * cards on the receiving side.
 */

export interface ShareOptions {
  subpages: boolean
  cards: boolean
}

export function shareCounts(rootId: string, opts: ShareOptions): { pages: number; cards: number } {
  const { pages } = useStore.getState()
  const ids = new Set([rootId, ...(opts.subpages ? descendantsOf(pages, rootId) : [])])
  const cards = opts.cards ? collectCards(ids).length : 0
  return { pages: ids.size, cards }
}

function collectCards(ids: Set<string>): SrsCard[] {
  return Object.values(useSrsStore.getState().cards).filter(
    c => (c.pageId && ids.has(c.pageId)) || c.refs.some(r => ids.has(r.pageId)),
  )
}

export function buildShareZip(
  rootId: string,
  opts: ShareOptions,
): { filename: string; data: Uint8Array; pages: number; cards: number } {
  const { pages } = useStore.getState()
  const root = pages[rootId]
  if (!root) throw new Error('page not found')

  const ids = new Set([rootId, ...(opts.subpages ? descendantsOf(pages, rootId) : [])])
  const titleOf = (id: string) => (pages[id] ? pages[id].title || 'Untitled' : null)

  const files: Record<string, Uint8Array> = {}
  const walk = (parentId: string, prefix: string) => {
    const used = new Set<string>()
    for (const child of childrenOf(pages, parentId)) {
      if (!ids.has(child.id)) continue
      const base = sanitizeFilename(child.title || 'Untitled')
      let candidate = base
      let n = 2
      while (used.has(candidate.toLowerCase())) candidate = `${base} ${n++}`
      used.add(candidate.toLowerCase())
      files[prefix + candidate + '.md'] = strToU8(pageToMarkdown(child, titleOf))
      walk(child.id, prefix + candidate + '/')
    }
  }

  const rootBase = sanitizeFilename(root.title || 'Untitled')
  files[rootBase + '.md'] = strToU8(pageToMarkdown(root, titleOf))
  if (opts.subpages) walk(rootId, rootBase + '/')

  let cardCount = 0
  if (opts.cards) {
    const shared = collectCards(ids).map(card => ({
      ...card,
      // Refs pointing outside the shared subtree would dangle — drop them;
      // their snapshots live on inside the card history anyway.
      refs: card.refs.filter(r => ids.has(r.pageId)),
    }))
    cardCount = shared.length
    if (shared.length) {
      const byId = Object.fromEntries(shared.map(c => [c.id, c]))
      files['.arete/cards.json'] = strToU8(JSON.stringify(byId, null, 2))
    }
  }

  return {
    filename: rootBase + '.zip',
    data: zipSync(files),
    pages: ids.size,
    cards: cardCount,
  }
}

/** Save a file: native save dialog in the desktop app, download in the browser. */
export async function saveZip(
  filename: string,
  data: Uint8Array,
  mime = 'application/zip',
): Promise<boolean> {
  if (isTauriEnv()) {
    const dialog = await import('@tauri-apps/plugin-dialog')
    const path = await dialog.save({ defaultPath: filename })
    if (typeof path !== 'string') return false
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.writeFile(path, data)
    return true
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}
