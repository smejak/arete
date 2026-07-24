import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Footnotes, Tufte-style: an inline atom that renders as an auto-numbered
 * superscript, whose text lives in the margin to the right of its block.
 * The content is a markdown string (edited with the same mini-editor cards
 * use, so every block feature works) and serializes as `^[text]`.
 *
 * Numbers are never stored — a decoration stamps each ref with its position
 * in document order, so deleting or reordering footnotes renumbers the rest
 * automatically. Numbering is per page: every page is its own document.
 */

export interface FootnoteRef {
  id: string
  md: string
  pos: number
  n: number
}

/** Footnotes of a doc in document order (n is 1-based). */
export function collectFootnotes(doc: PMNode): FootnoteRef[] {
  const out: FootnoteRef[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') {
      out.push({ id: node.attrs.id as string, md: (node.attrs.md as string) ?? '', pos, n: out.length + 1 })
    }
  })
  return out
}

export const Footnote = Node.create({
  name: 'footnote',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-id'),
        renderHTML: attrs => ({ 'data-id': attrs.id }),
      },
      md: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-md') ?? '',
        renderHTML: attrs => ({ 'data-md': attrs.md }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '', class: 'fn-ref' })]
  },

  addInputRules() {
    return [
      // "^" + space drops a footnote right where you are and opens its
      // margin editor (via the footnoteCreated meta the margin listens for).
      new InputRule({
        find: /\^\s$/,
        handler: ({ state, range, chain }) => {
          if (state.selection.$from.marks().some(m => m.type.name === 'code')) return
          const id = crypto.randomUUID()
          chain()
            .deleteRange(range)
            .insertContent({ type: this.name, attrs: { id, md: '' } })
            .command(({ tr }) => {
              tr.setMeta('footnoteCreated', id)
              return true
            })
            .run()
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const name = this.name
    return [
      new Plugin({
        key: new PluginKey('footnoteNumbers'),
        props: {
          // Stamp every ref with its 1-based document-order index; CSS
          // renders it (content: attr(data-n)).
          decorations(state) {
            const decos: Decoration[] = []
            let i = 0
            state.doc.descendants((node, pos) => {
              if (node.type.name === name) {
                i++
                decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-n': String(i) }))
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
          // Clicking a number is handled by whoever hosts the editor (the
          // page margin, a popover…) — broadcast instead of hardcoding.
          // DOM-target based: clicks on inline leaf atoms resolve to caret
          // positions beside the node, so handleClickOn never sees them.
          handleDOMEvents: {
            click(view, event) {
              const sup = (event.target as HTMLElement | null)?.closest?.('sup.fn-ref')
              if (!sup || !view.dom.contains(sup)) return false
              const id = sup.getAttribute('data-id')
              if (!id) return false
              sup.dispatchEvent(
                new CustomEvent('arete-footnote-click', { bubbles: true, detail: { id } }),
              )
              return true
            },
          },
        },
      }),
    ]
  },
})
