import type { JSONContent } from '@tiptap/core'
import type { OptionColor } from '../store/types'
import { OPTION_COLORS } from './db'
import type { Pages } from './tree'

/**
 * Block tags: one vocabulary for the whole vault.
 *
 * A tag is a plain string on the block, exactly as card tags are plain strings
 * on a card. The registry in `.arete/meta.json` adds a colour and, for a
 * group, an ordering — it never decides what exists. Anything found in use and
 * missing from the registry simply gets a default colour, so a vault opened
 * without its meta file loses presentation and nothing else. Same bargain the
 * progress block struck: the least-constraining thing that works.
 */

/**
 * Two jobs, deliberately separated.
 *
 * A **category** is for finding: many blocks may carry it, and it narrows a
 * search. Pasting one collectively would be nonsense — forty paragraphs
 * because you once tagged them all "cardio".
 *
 * A **group** is for reading together: a small, chosen set with an order, and
 * the only kind that `/reference` and `/copy` will act on whole.
 *
 * Which one a tag is has to be said, not guessed. Inferring it from whether an
 * ordering happens to exist, or from how many blocks carry it, is wrong in
 * both directions and silently so.
 */
export type TagKind = 'category' | 'group'

export interface TagDef {
  name: string
  color: OptionColor
  /** Absent means category — the default, and what a tag is until promoted. */
  kind?: TagKind
  /** Groups only: the order its blocks are read in. Membership still comes
   * from the blocks that carry the tag — this only says in what sequence, so
   * a stale entry is inert rather than wrong. */
  order?: BlockAddr[]
}

export const kindOf = (registry: TagDef[], name: string): TagKind =>
  registry.find(t => t.name === name)?.kind ?? 'category'

export const isGroup = (registry: TagDef[], name: string): boolean =>
  kindOf(registry, name) === 'group'

/** Every tag promoted to a group, for the pickers that only offer those. */
export const groupTags = (registry: TagDef[]): TagDef[] =>
  registry.filter(t => t.kind === 'group')

/** A block, durably. `id` is minted only when a block is first tagged. */
export interface BlockAddr {
  pageId: string
  blockId: string
}

/** Blocks that can carry a tag — the ones with a handle and words in them. */
export const TAGGABLE = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'callout',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'toggle',
  'mathBlock',
])

/** Short, readable, and enough of them: ids only ever appear on tagged
 * blocks, and they are compared, never sorted. */
export const newBlockId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8)

const SLUG = /[^a-z0-9/_-]+/g

/** Tags are compared lowercase and space-free so "Cardio" and "cardio" are one
 * tag, however they were typed. */
export const normalizeTag = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, '-').replace(SLUG, '')

export function parseTagList(raw: string): string[] {
  return Array.from(new Set(raw.split(/[,\s]+/).map(normalizeTag).filter(Boolean)))
}

/** A stable colour for a tag with no registry entry — same name, same colour,
 * so an unregistered tag still reads as itself. */
export function fallbackColor(name: string): OptionColor {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const usable = OPTION_COLORS.filter(c => c !== 'default')
  return usable[h % usable.length]
}

export const colorOf = (registry: TagDef[], name: string): OptionColor =>
  registry.find(t => t.name === name)?.color ?? fallbackColor(name)

export const defOf = (registry: TagDef[], name: string): TagDef | undefined =>
  registry.find(t => t.name === name)

/**
 * Every block in a page that could carry a tag, in document order.
 *
 * Depth-first, because the block handle descends into containers: a paragraph
 * inside a callout, a toggle or a list item has its own handle and can be
 * tagged like any other. Walking only the top level made those tags invisible
 * to every reader of them — the tag was on the block and nothing could find
 * it, so it read as not having been saved at all.
 */
function walkBlocks(node: JSONContent, fn: (block: JSONContent) => void): void {
  for (const child of node.content ?? []) {
    if (!child.type || child.type === 'text') continue
    fn(child)
    walkBlocks(child, fn)
  }
}

/** Every tag in use, with how many blocks carry it — the vocabulary is
 * derived, so this is the authority on what exists. */
export function tagUsage(pages: Pages): Map<string, number> {
  const counts = new Map<string, number>()
  for (const page of Object.values(pages)) {
    if (!page.content) continue
    walkBlocks(page.content, block => {
      for (const tag of (block.attrs?.tags as string[] | undefined) ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    })
  }
  return counts
}

export interface TaggedBlock extends BlockAddr {
  index: number
  node: JSONContent
  tags: string[]
}

/** Blocks carrying `tag`, in document order across the vault. */
export function blocksWithTag(pages: Pages, tag: string): TaggedBlock[] {
  const out: TaggedBlock[] = []
  for (const page of Object.values(pages)) {
    if (!page.content) continue
    let index = 0
    walkBlocks(page.content, node => {
      const at = index++
      const tags = (node.attrs?.tags as string[] | undefined) ?? []
      if (!tags.includes(tag)) return
      out.push({
        pageId: page.id,
        blockId: (node.attrs?.blockId as string) ?? '',
        index: at,
        node,
        tags,
      })
    })
  }
  return out
}

/**
 * A group's blocks, in order: the saved sequence first, then anything tagged
 * since that the order has not heard of. Entries in the order whose block has
 * lost the tag fall away on their own.
 */
export function groupBlocks(pages: Pages, tag: string, order?: BlockAddr[]): TaggedBlock[] {
  const members = blocksWithTag(pages, tag)
  if (!order?.length) return members
  const byId = new Map(members.filter(m => m.blockId).map(m => [m.blockId, m]))
  const seen = new Set<string>()
  const sorted: TaggedBlock[] = []
  for (const addr of order) {
    const hit = byId.get(addr.blockId)
    if (hit && !seen.has(hit.blockId)) {
      seen.add(hit.blockId)
      sorted.push(hit)
    }
  }
  for (const m of members) if (!m.blockId || !seen.has(m.blockId)) sorted.push(m)
  return sorted
}
