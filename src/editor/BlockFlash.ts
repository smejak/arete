import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Lights one block, briefly — where a block reference lands.
 *
 * A decoration rather than a class on the DOM node: ProseMirror re-renders
 * block elements whenever it likes, and it does so right after mount, which
 * is exactly when a reference arrives. A class put there by hand is wiped
 * before the reader has looked up. A decoration is part of the view's own
 * rendering, so it survives, and it maps through edits for free.
 */

export const blockFlashKey = new PluginKey<DecorationSet>('blockFlash')

/** Hold, then fade — the timing lives in the `block-flash` keyframes. */
export const BLOCK_FLASH_MS = 5400

export const BlockFlash = Extension.create({
  name: 'blockFlash',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockFlashKey,
        // The set lives in plugin state and keeps its identity across updates.
        // Rebuilding it inside `decorations()` looks equivalent and is not:
        // a fresh DecorationSet on every state change re-renders the block's
        // DOM, which restarts the CSS animation from zero. Do that often
        // enough — and an editor with a store behind it does — and the
        // highlight never becomes visible at all.
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const meta = tr.getMeta(blockFlashKey) as number | null | undefined
            if (meta === null) return DecorationSet.empty
            if (typeof meta === 'number') {
              const node = tr.doc.nodeAt(meta)
              if (!node) return DecorationSet.empty
              return DecorationSet.create(tr.doc, [
                Decoration.node(meta, meta + node.nodeSize, { class: 'block-flash' }),
              ])
            }
            return value.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return blockFlashKey.getState(state)
          },
        },
      }),
    ]
  },
})
