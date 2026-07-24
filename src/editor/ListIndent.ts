import { Extension } from '@tiptap/core'
import { NodeRange } from '@tiptap/pm/model'
import { liftTarget } from '@tiptap/pm/transform'

const ITEM_TYPES = ['listItem', 'taskItem']
const LIST_TYPES = ['bulletList', 'orderedList', 'taskList']

/**
 * Notion-style indenting. The native sink/lift cover the common cases (an
 * item nesting under the bullet above it); this adds the missing ones, which
 * work because lists may nest directly inside lists in Arete's schema:
 *  - Tab on a first/only bullet wraps it in a list of its own type, so ANY
 *    bullet can be indented, parent or not (merging into a same-type list
 *    sitting right above instead of stacking a second one).
 *  - Shift-Tab on an item whose list sits directly inside another list lifts
 *    it one list out (the native lift would flatten it to a paragraph).
 */
export const ListIndent = Extension.create({
  name: 'listIndent',

  addKeyboardShortcuts() {
    /** Depth of the enclosing list item, or 0. */
    const itemDepth = () => {
      const { $from } = this.editor.state.selection
      for (let d = $from.depth; d > 0; d--) {
        if (ITEM_TYPES.includes($from.node(d).type.name)) return d
      }
      return 0
    }

    return {
      Tab: () => {
        const { editor } = this
        if (editor.commands.sinkListItem('listItem')) return true
        if (editor.commands.sinkListItem('taskItem')) return true
        const d = itemDepth()
        if (!d) return false
        return editor.commands.command(({ state, tr, dispatch }) => {
          const { $from } = state.selection
          const item = $from.node(d)
          const listType = $from.node(d - 1).type
          const itemPos = $from.before(d)
          const $a = state.doc.resolve(itemPos)
          const $b = state.doc.resolve(itemPos + item.nodeSize)
          const range = new NodeRange($a, $b, d - 1)
          if (dispatch) {
            tr.wrap(range, [{ type: listType }])
            // A same-type list right above absorbs the fresh wrapper, so
            // repeated tabs deepen one list instead of stacking siblings.
            const $wrap = tr.doc.resolve(tr.mapping.map(itemPos, -1))
            if ($wrap.nodeBefore?.type === listType) tr.join($wrap.pos)
            tr.scrollIntoView()
          }
          return true
        })
      },

      'Shift-Tab': () => {
        const { editor } = this
        const d = itemDepth()
        if (!d) return false
        const { $from } = editor.state.selection
        const grandparent = d >= 2 ? $from.node(d - 2) : null
        // Item's list nested directly in another list → dedent one list.
        if (grandparent && LIST_TYPES.includes(grandparent.type.name)) {
          return editor.commands.command(({ state, tr, dispatch }) => {
            const $f = state.selection.$from
            const item = $f.node(d)
            const itemPos = $f.before(d)
            const $a = state.doc.resolve(itemPos)
            const $b = state.doc.resolve(itemPos + item.nodeSize)
            const range = new NodeRange($a, $b, d - 1)
            const target = liftTarget(range)
            if (target == null) return false
            if (dispatch) tr.lift(range, target).scrollIntoView()
            return true
          })
        }
        if (editor.commands.liftListItem('listItem')) return true
        return editor.commands.liftListItem('taskItem')
      },
    }
  },
})
