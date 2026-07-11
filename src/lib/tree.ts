import type { JSONContent } from '@tiptap/core'
import type { Page } from '../store/types'

export type Pages = Record<string, Page>

export function childrenOf(pages: Pages, parentId: string | null): Page[] {
  return Object.values(pages)
    .filter(p => p.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/** All ids below `id`, depth-first. Does not include `id` itself. */
export function descendantsOf(pages: Pages, id: string): string[] {
  const out: string[] = []
  const walk = (pid: string) => {
    for (const c of childrenOf(pages, pid)) {
      out.push(c.id)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

/** Chain of ancestors from root down to (excluding) `id`. */
export function ancestorsOf(pages: Pages, id: string): Page[] {
  const out: Page[] = []
  let cur = pages[id]?.parentId
  while (cur) {
    const p = pages[cur]
    if (!p) break
    out.unshift(p)
    cur = p.parentId
  }
  return out
}

/** True if `id` sits inside the subtree rooted at `rootId` (or is that root). */
export function inSubtree(pages: Pages, id: string, rootId: string): boolean {
  let cur: string | null | undefined = id
  let hops = 0
  while (cur && hops++ < 1000) {
    if (cur === rootId) return true
    cur = pages[cur]?.parentId
  }
  return false
}

export function extractText(node: JSONContent | null | undefined): string {
  if (!node) return ''
  let s = node.text ?? ''
  if ((node.type === 'mathInline' || node.type === 'mathBlock') && typeof node.attrs?.latex === 'string') {
    s += (s ? ' ' : '') + node.attrs.latex
  }
  for (const c of node.content ?? []) {
    const t = extractText(c)
    if (t) s += (s ? ' ' : '') + t
  }
  return s
}

export function wordCount(node: JSONContent | null | undefined): number {
  return extractText(node).split(/\s+/).filter(Boolean).length
}

/** True if the content contains a page-link block pointing at `pageId`. */
export function hasPageLink(node: JSONContent, pageId: string): boolean {
  if (node.type === 'pageLink' && node.attrs?.pageId === pageId) return true
  return (node.content ?? []).some(c => hasPageLink(c, pageId))
}

/** Remove owner page-link blocks pointing at `pageId`, wherever they nest. */
export function stripOwnedLink(
  node: JSONContent,
  pageId: string,
): { content: JSONContent; removed: boolean } {
  let removed = false
  const walk = (n: JSONContent): JSONContent => {
    if (!n.content) return n
    const kids = n.content
      .filter(c => {
        const hit = c.type === 'pageLink' && c.attrs?.owner === true && c.attrs?.pageId === pageId
        if (hit) removed = true
        return !hit
      })
      .map(walk)
    return { ...n, content: kids }
  }
  return { content: walk(node), removed }
}

/** Rewrite page references (link blocks and @ mentions) after duplicating a
 * subtree, so copies point at the copied pages rather than the originals. */
export function remapPageLinks(node: JSONContent, map: Map<string, string>): JSONContent {
  const n: JSONContent = { ...node }
  if (
    (n.type === 'pageLink' || n.type === 'pageMention' || n.type === 'databaseBlock') &&
    typeof n.attrs?.pageId === 'string' &&
    map.has(n.attrs.pageId)
  ) {
    n.attrs = { ...n.attrs, pageId: map.get(n.attrs.pageId)! }
  }
  if (n.content) n.content = n.content.map(c => remapPageLinks(c, map))
  return n
}
