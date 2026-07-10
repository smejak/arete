import type { Editor, JSONContent } from '@tiptap/core'
import type { Pages } from './tree'
import type { CardRef, SrsCard } from '../store/types'

/** Collect the live text for each of a card's highlights by walking a page
 * document for `cardref` marks, grouped per refId. */
export function collectRefTexts(content: JSONContent | null | undefined, cardId: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!content) return out
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && node.text && node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'cardref' && mark.attrs?.cardId === cardId) {
          const refId = String(mark.attrs.refId)
          out.set(refId, (out.get(refId) ?? '') + node.text)
        }
      }
    }
    node.content?.forEach(walk)
  }
  walk(content)
  return out
}

/** Live text for one ref, falling back to the snapshot taken at creation. */
export function refText(pages: Pages, card: SrsCard, ref: CardRef): { text: string; live: boolean } {
  const page = pages[ref.pageId]
  if (page) {
    const live = collectRefTexts(page.content, card.id).get(ref.refId)
    if (live && live.trim()) return { text: live, live: true }
  }
  return { text: ref.snapshot, live: false }
}

export function applyCardRefMark(editor: Editor, from: number, to: number, cardId: string, refId: string) {
  const type = editor.schema.marks.cardref
  if (!type) return
  editor.view.dispatch(editor.state.tr.addMark(from, to, type.create({ cardId, refId })))
}

/** Strip every cardref mark belonging to `cardId` (composer cancelled). */
export function removeCardRefMarks(editor: Editor, cardId: string) {
  const { state } = editor
  const tr = state.tr
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const mark of node.marks) {
      if (mark.type.name === 'cardref' && mark.attrs.cardId === cardId) {
        tr.removeMark(pos, pos + node.nodeSize, mark)
      }
    }
  })
  if (tr.steps.length) editor.view.dispatch(tr)
}

/**
 * Flash every highlight of a card inside the rendered page for five seconds,
 * scrolling the first one into view. Returns whether anything was found.
 *
 * Styling is injected as an attribute-selector stylesheet rather than by
 * toggling classes: ProseMirror re-renders mark DOM at will and resets
 * className, but it always re-renders the data-card attribute from the mark.
 * (cardId is a UUID — hex and hyphens — so it is selector-safe raw;
 * CSS.escape would identifier-escape a leading digit and break the match.)
 */
export function flashCardRefs(container: HTMLElement, cardId: string): boolean {
  const selector = `span.cardref[data-card="${cardId}"]`
  const spans = container.querySelectorAll<HTMLElement>(selector)
  if (!spans.length) return false
  spans[0].scrollIntoView({ block: 'center', behavior: 'smooth' })

  const style = document.createElement('style')
  style.textContent = `${selector} { background: var(--hl); box-shadow: 0 0 0 2.5px var(--hl); border-radius: 3px; transition: background .25s ease, box-shadow .25s ease; }`
  document.head.appendChild(style)
  window.setTimeout(() => {
    style.textContent = `${selector} { background: transparent; box-shadow: 0 0 0 2.5px transparent; border-radius: 3px; transition: background 1.2s ease, box-shadow 1.2s ease; }`
    window.setTimeout(() => style.remove(), 1300)
  }, 5000)
  return true
}
