import type { JSONContent } from '@tiptap/core'
import type { Page } from '../store/types'
import { docToMarkdown } from './markdown'
import { blockText, normText } from './blocks'
import { groupBlocks, type TagDef } from './tags'
import type { Pages } from './tree'

/**
 * A page as markdown, for the clipboard.
 *
 * The body only — frontmatter carries vault plumbing (ids, order, sync
 * bookkeeping) that means nothing outside the folder it came from. Everything
 * else is exactly what the file holds, pointers included: a wikilink stays a
 * wikilink, an embed stays its media line.
 *
 * References are the one thing worth a choice. On screen they should stay
 * pointers — that is what they are. But text pasted elsewhere has no vault to
 * resolve them against, so `expandRefs` swaps each one for the markdown of
 * what it points at, in place.
 */

/** Substitute reference nodes for the blocks they point at. */
function expandRefs(
  blocks: JSONContent[],
  pages: Pages,
  registry: TagDef[],
): JSONContent[] {
  const out: JSONContent[] = []
  for (const node of blocks) {
    if (node.type === 'blockRef') {
      const target = findBlock(pages, node.attrs?.pageId as string, node.attrs?.text as string)
      // A reference whose text has moved on stays a pointer rather than
      // silently pasting the wrong paragraph.
      out.push(target ?? node)
      continue
    }
    if (node.type === 'groupRef') {
      const tag = (node.attrs?.tag as string) ?? ''
      const order = registry.find(t => t.name === tag)?.order
      const members = groupBlocks(pages, tag, order)
      if (!members.length) {
        out.push(node)
        continue
      }
      // Copies, so they arrive without the tags that made them a group.
      for (const m of members) {
        out.push({ ...m.node, attrs: { ...(m.node.attrs ?? {}), tags: null, blockId: null } })
      }
      continue
    }
    out.push(node)
  }
  return out
}

function findBlock(pages: Pages, pageId: string, text: string): JSONContent | null {
  const page = pages[pageId]
  const want = normText(text ?? '')
  if (!page?.content?.content || !want) return null
  return page.content.content.find(b => normText(blockText(b)).includes(want)) ?? null
}

export function pageMarkdown(
  page: Page,
  pages: Pages,
  registry: TagDef[],
  opts: { expandRefs?: boolean } = {},
): string {
  const blocks = page.content?.content ?? []
  const content = opts.expandRefs ? expandRefs(blocks, pages, registry) : blocks
  const titleOf = (id: string) => pages[id]?.title ?? null
  return docToMarkdown({ type: 'doc', content }, titleOf)
}

/** Clipboard write that works in the app and in a plain browser tab. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a focused document and a secure context; the
    // textarea route needs neither.
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}
