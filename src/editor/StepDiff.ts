import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { BlockChange } from '../lib/doc-diff'

/**
 * Lights what just arrived, while stepping through a page's history.
 *
 * Same bargain as BlockFlash: the set lives in plugin state so it keeps its
 * identity across updates. A DecorationSet rebuilt inside `decorations()` is
 * a new object every time, which re-renders the marked nodes and restarts the
 * CSS animation from zero — permanently, if anything else is dispatching.
 */

export interface DiffDeco {
  kind: 'inline' | 'block'
  from: number
  to: number
}

export const stepDiffKey = new PluginKey<DecorationSet>('stepDiff')

/** Hold, then fade. The timing itself lives in the `step-add` keyframes; this
 * is only when the decorations stop existing. */
export const STEP_FLASH_MS = 1500

/**
 * Char offsets → document positions.
 *
 * `blockText` builds a block's string by concatenating its descendants depth
 * first with nothing between them, and `descendants` walks in that same order,
 * so running a counter alongside the walk is enough to place every offset. The
 * two have to agree exactly: a separator in one and not the other would slide
 * every highlight in the block by the number of joins before it.
 */
export function diffDecorations(doc: PMNode, changes: BlockChange[]): DiffDeco[] {
  if (!changes.length) return []
  const byIndex = new Map(changes.map(c => [c.index, c]))
  const out: DiffDeco[] = []

  let index = 0
  doc.forEach((node, offset) => {
    const change = byIndex.get(index++)
    if (!change) return

    if (change.whole) {
      out.push({ kind: 'block', from: offset, to: offset + node.nodeSize })
      return
    }

    // Positions inside a block start one past the block's own opening token.
    const base = offset + 1
    let acc = 0
    node.descendants((child, pos) => {
      if (!child.isText) return true
      const len = child.text?.length ?? 0
      const start = acc
      const end = acc + len
      acc = end
      for (const [rs, re] of change.ranges) {
        const s = Math.max(rs, start)
        const e = Math.min(re, end)
        if (s < e) out.push({ kind: 'inline', from: base + pos + (s - start), to: base + pos + (e - start) })
      }
      return false
    })
  })

  return out
}

export const StepDiff = Extension.create({
  name: 'stepDiff',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: stepDiffKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const meta = tr.getMeta(stepDiffKey) as DiffDeco[] | null | undefined
            if (meta === null) return DecorationSet.empty
            if (Array.isArray(meta)) {
              return DecorationSet.create(
                tr.doc,
                meta.map(d =>
                  d.kind === 'block'
                    ? Decoration.node(d.from, d.to, { class: 'step-add-block' })
                    : Decoration.inline(d.from, d.to, { class: 'step-add' }),
                ),
              )
            }
            return value.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return stepDiffKey.getState(state)
          },
        },
      }),
    ]
  },
})
