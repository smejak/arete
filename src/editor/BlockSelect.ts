import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface BlockRange {
  from: number
  to: number
}

/** Dispatch `tr.setMeta(blockSelectKey, {from,to} | null)` to drive it. */
export const blockSelectKey = new PluginKey<BlockRange | null>('blockSelect')

/**
 * Notion-style whole-block selection: PageView's rubber band feeds a
 * top-level range through the plugin meta; every block in the range gets a
 * `.block-selected` tint, and a real TextSelection spans them so copy,
 * delete, and typing behave natively. Any ordinary click, edit, or Escape
 * clears it.
 */
export const BlockSelect = Extension.create({
  name: 'blockSelect',

  addKeyboardShortcuts() {
    return {
      Escape: () => {
        const range = blockSelectKey.getState(this.editor.state)
        if (!range) return false
        const { state, view } = this.editor
        const sel = TextSelection.near(state.doc.resolve(state.selection.from))
        view.dispatch(state.tr.setMeta(blockSelectKey, null).setSelection(sel))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<BlockRange | null>({
        key: blockSelectKey,
        state: {
          init: () => null,
          apply(tr, prev) {
            const meta = tr.getMeta(blockSelectKey) as BlockRange | null | undefined
            if (meta !== undefined) return meta
            // Any edit or ordinary selection change dissolves the block state.
            if (tr.docChanged || tr.selectionSet) return null
            return prev
          },
        },
        props: {
          // While blocks are selected, the block tint is the only highlight —
          // the native ::selection paint underneath is suppressed via CSS.
          attributes(state) {
            return { class: blockSelectKey.getState(state) ? 'is-block-selecting' : '' }
          },
          decorations(state) {
            const range = blockSelectKey.getState(state)
            if (!range) return null
            const decos: Decoration[] = []
            // A range matching exactly one node (six-dot click, possibly a
            // nested list item) tints just that node; band ranges sweep the
            // top-level blocks they touch.
            const exact = state.doc.nodeAt(range.from)
            if (exact && range.from + exact.nodeSize === range.to) {
              decos.push(Decoration.node(range.from, range.to, { class: 'block-selected' }))
            } else {
              state.doc.forEach((node, offset) => {
                if (offset + node.nodeSize > range.from && offset < range.to) {
                  decos.push(
                    Decoration.node(offset, offset + node.nodeSize, { class: 'block-selected' }),
                  )
                }
              })
            }
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
