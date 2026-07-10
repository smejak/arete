import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Keeps an empty paragraph at the end of the document so there is always a
 * place to type below dividers, code blocks, callouts, and page links.
 */
export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingNode'),
        appendTransaction: (_transactions, _oldState, state) => {
          const { doc, schema } = state
          const last = doc.lastChild
          if (last && last.type.name === 'paragraph') return
          const paragraph = schema.nodes.paragraph
          if (!paragraph) return
          return state.tr.insert(doc.content.size, paragraph.create())
        },
      }),
    ]
  },
})
