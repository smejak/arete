import type { JSONContent } from '@tiptap/core'
import type { Pages } from './tree'

/**
 * A block's text exactly as ProseMirror concatenates it — runs joined with
 * nothing between them.
 *
 * Not `extractText`: that one joins children with a space, which is harmless
 * when scoring a whole page but doubles the space around every bold, link or
 * code span. A reference built from that string is a couple of characters
 * longer than the paragraph it came from and never matches it again.
 */
export function blockText(node: JSONContent): string {
  let out = node.text ?? ''
  for (const child of node.content ?? []) out += blockText(child)
  return out
}

/** Compare-safe form, so a round-trip through markdown cannot break a match
 * on a re-wrapped line or a stray double space. */
export const normText = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * The vault's text blocks, as a searchable list.
 *
 * A "block" here is what carries a handle in the editor: a top-level child of
 * a page's doc. Lists count once, as the list — the handle sits beside the
 * whole thing, and a bullet on its own is rarely what someone means when they
 * say they remember reading something.
 *
 * The index is rebuilt per query rather than kept warm. Every page already
 * lives in memory, so this is a walk over data we hold; if a vault ever grows
 * past the point where that stops being instant, the shape here is what an
 * incremental index would have to reproduce.
 */

export interface BlockHit {
  pageId: string
  /** Position among the page's top-level blocks — the address we navigate to. */
  index: number
  node: JSONContent
  text: string
}

/** A run of the snippet, flagged when it matched a search term. */
export interface Part {
  text: string
  hit: boolean
}

export interface BlockMatch extends BlockHit {
  score: number
  parts: Part[]
}

/** Blocks with no prose of their own — nothing to search, nothing to quote. */
const SKIP = new Set(['horizontalRule', 'imageBlock', 'audioBlock', 'htmlBlock', 'progressBlock', 'databaseBlock'])

export function indexBlocks(pages: Pages): BlockHit[] {
  const out: BlockHit[] = []
  for (const page of Object.values(pages)) {
    const blocks = page.content?.content ?? []
    blocks.forEach((node, index) => {
      if (!node.type || SKIP.has(node.type)) return
      const text = blockText(node).trim()
      if (text) out.push({ pageId: page.id, index, node, text })
    })
  }
  return out
}

const SNIPPET = 180

/** Every occurrence of any term, merged where they overlap. */
function ranges(lower: string, terms: string[]): [number, number][] {
  const found: [number, number][] = []
  for (const term of terms) {
    let at = lower.indexOf(term)
    while (at !== -1) {
      found.push([at, at + term.length])
      at = lower.indexOf(term, at + term.length)
    }
  }
  found.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of found) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

/** A window around the first match, split into matched and unmatched runs. */
function snippet(text: string, hits: [number, number][]): Part[] {
  if (!hits.length) return [{ text: text.slice(0, SNIPPET), hit: false }]
  // Start a little before the first hit, on a word boundary where possible.
  let from = Math.max(0, hits[0][0] - 40)
  if (from > 0) {
    const space = text.indexOf(' ', from)
    if (space !== -1 && space < hits[0][0]) from = space + 1
  }
  const to = Math.min(text.length, from + SNIPPET)
  const parts: Part[] = []
  let at = from
  for (const [s, e] of hits) {
    if (s >= to) break
    if (e <= from) continue
    const start = Math.max(s, from)
    if (start > at) parts.push({ text: text.slice(at, start), hit: false })
    parts.push({ text: text.slice(start, Math.min(e, to)), hit: true })
    at = Math.min(e, to)
  }
  if (at < to) parts.push({ text: text.slice(at, to), hit: false })
  if (from > 0) parts.unshift({ text: '… ', hit: false })
  if (to < text.length) parts.push({ text: ' …', hit: false })
  return parts
}

export function searchBlocks(pages: Pages, query: string, limit = 12): BlockMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = Array.from(new Set(q.split(/\s+/).filter(Boolean)))

  const out: BlockMatch[] = []
  for (const hit of indexBlocks(pages)) {
    const lower = hit.text.toLowerCase()
    // Every word has to be in there — a block matching half your query is
    // noise you have to read past.
    if (!terms.every(t => lower.includes(t))) continue

    let score = 0
    const phrase = lower.indexOf(q)
    if (phrase !== -1) score += 60 - Math.min(30, phrase / 8)
    for (const term of terms) {
      const at = lower.indexOf(term)
      score += 10
      // A word start beats a match buried inside a longer word.
      if (at === 0 || !/\w/.test(lower[at - 1] ?? '')) score += 6
    }
    // Among equally good matches, the tighter block is the better quote.
    score += Math.max(0, 12 - hit.text.length / 120)

    out.push({ ...hit, score, parts: snippet(hit.text, ranges(lower, terms)) })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** The doc position of a page's nth top-level block, for selecting or
 * scrolling to it. ProseMirror counts the doc's own opening token as 0. */
export function blockPos(doc: JSONContent, index: number): number | null {
  const blocks = doc.content ?? []
  if (index < 0 || index >= blocks.length) return null
  let pos = 0
  for (let i = 0; i < index; i++) pos += nodeSize(blocks[i])
  return pos
}

/** Serialized-node size, matching ProseMirror's own accounting closely enough
 * to address a top-level block. */
function nodeSize(node: JSONContent): number {
  if (node.type === 'text') return node.text?.length ?? 0
  const inner = (node.content ?? []).reduce((sum, c) => sum + nodeSize(c), 0)
  return inner + 2
}
