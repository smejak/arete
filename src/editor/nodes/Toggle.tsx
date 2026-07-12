import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { cx } from '../../lib/util'

function ToggleView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open as boolean

  const addChild = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const end = pos + node.nodeSize - 1
    editor.chain().insertContentAt(end, { type: 'paragraph' }).setTextSelection(end + 1).focus().run()
  }

  return (
    <NodeViewWrapper className={cx('toggle-block', open && 'is-open')} data-type="toggle">
      <button
        type="button"
        className="toggle-arrow"
        contentEditable={false}
        tabIndex={-1}
        title={open ? 'Collapse' : 'Expand'}
        onMouseDown={e => e.preventDefault()}
        onClick={() => updateAttributes({ open: !open })}
      >
        <ChevronRight size={16} strokeWidth={2} />
      </button>
      <div className="toggle-col">
        <NodeViewContent className="toggle-body" />
        {open && node.childCount === 1 && editor.isEditable && (
          <button
            type="button"
            className="toggle-empty"
            contentEditable={false}
            onMouseDown={e => e.preventDefault()}
            onClick={addChild}
          >
            Empty toggle. Click to add content.
          </button>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/**
 * Notion-style toggle: the first paragraph is the always-visible summary,
 * everything after it collapses. `>` at the start of a line wraps into one
 * (quotes moved to `"`). Children stay in the doc when collapsed — they're
 * only hidden — so search, sync, and cards keep seeing them.
 */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'paragraph block*',
  defining: true,

  addAttributes() {
    return { open: { default: true } }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="toggle"]',
        getAttrs: el => ({ open: (el as HTMLElement).dataset.open !== 'false' }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'toggle',
        'data-open': node.attrs.open ? 'true' : 'false',
      }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*>\s$/,
        type: this.type,
        // Never merge into an adjacent toggle: the default same-type join
        // (right for bullet lists) would swallow the new toggle into the
        // hidden body of a collapsed one directly above.
        joinPredicate: () => false,
      }),
    ]
  },

  addKeyboardShortcuts() {
    /** Depth of the nearest enclosing toggle, or null. */
    const toggleDepth = ($from: import('@tiptap/pm/model').ResolvedPos): number | null => {
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === this.name) return d
      }
      return null
    }

    /** Cursor sits directly in the summary paragraph of the toggle at `d`. */
    const inSummary = ($from: import('@tiptap/pm/model').ResolvedPos, d: number) =>
      $from.depth === d + 1 && $from.index(d) === 0 && $from.parent.type.name === 'paragraph'

    /** Arrowing down/right out of a collapsed summary skips the hidden body. */
    const escapeClosed = (dir: 'down' | 'right') => () => {
      const { state, view } = this.editor
      const { $from, empty } = state.selection
      if (!empty) return false
      const d = toggleDepth($from)
      if (d === null || !inSummary($from, d) || $from.node(d).attrs.open) return false
      if (!view.endOfTextblock(dir)) return false
      const sel = Selection.near(state.doc.resolve($from.after(d)), 1)
      view.dispatch(state.tr.setSelection(sel).scrollIntoView())
      return true
    }

    return {
      Enter: () =>
        this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection
          if (!empty) return false
          const d = toggleDepth($from)
          if (d === null) return false
          const toggle = $from.node(d)
          // Trailing empty child line steps out of the toggle (like callouts).
          if (
            $from.depth === d + 1 &&
            $from.index(d) === toggle.childCount - 1 &&
            $from.index(d) > 0 &&
            $from.parent.type.name === 'paragraph' &&
            $from.parent.content.size === 0
          ) {
            if (dispatch) {
              const after = $from.after(d)
              tr.delete($from.before($from.depth), $from.after($from.depth))
              const insertAt = tr.mapping.map(after)
              tr.insert(insertAt, state.schema.nodes.paragraph.create())
              tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
              tr.scrollIntoView()
            }
            return true
          }
          // Enter on an EMPTY childless summary dissolves the toggle into a
          // paragraph — the way an empty bullet ends a list.
          if (
            inSummary($from, d) &&
            toggle.childCount === 1 &&
            toggle.child(0).content.size === 0
          ) {
            if (dispatch) {
              const pos = $from.before(d)
              tr.replaceWith(pos, pos + toggle.nodeSize, state.schema.nodes.paragraph.create())
              tr.setSelection(TextSelection.create(tr.doc, pos + 1))
              tr.scrollIntoView()
            }
            return true
          }
          // Enter on a collapsed summary chains a fresh collapsed toggle
          // below, like list items continue. (Open toggles split into a
          // first child instead.)
          if (inSummary($from, d) && !toggle.attrs.open) {
            if (dispatch) {
              const after = $from.after(d)
              const next = this.type.create(
                { open: false },
                state.schema.nodes.paragraph.create(),
              )
              tr.insert(after, next)
              tr.setSelection(TextSelection.create(tr.doc, after + 2))
              tr.scrollIntoView()
            }
            return true
          }
          return false
        }),

      Backspace: () =>
        this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection
          if (!empty || $from.parentOffset !== 0) return false
          // Start of the summary: unwrap — summary becomes a paragraph and
          // the children spill out after it.
          const d = toggleDepth($from)
          if (d !== null && inSummary($from, d)) {
            if (dispatch) {
              const pos = $from.before(d)
              const toggle = $from.node(d)
              tr.replaceWith(pos, pos + toggle.nodeSize, toggle.content)
              tr.setSelection(TextSelection.create(tr.doc, pos + 1))
            }
            return true
          }
          // Start of the block after a collapsed toggle: select the toggle
          // instead of silently merging into its hidden last child.
          if ($from.depth < 1) return false
          const $block = state.doc.resolve($from.before($from.depth))
          const prev = $block.nodeBefore
          if (prev?.type.name === this.name && prev.attrs.open === false) {
            if (dispatch) {
              tr.setSelection(NodeSelection.create(state.doc, $block.pos - prev.nodeSize))
            }
            return true
          }
          return false
        }),

      ArrowDown: escapeClosed('down'),
      ArrowRight: escapeClosed('right'),

      // ⌘↩ folds/unfolds the toggle around the caret.
      'Mod-Enter': () =>
        this.editor.commands.command(({ state, tr, dispatch }) => {
          const sel = state.selection
          if (sel instanceof NodeSelection && sel.node.type.name === this.name) {
            if (dispatch) {
              tr.setNodeMarkup(sel.from, undefined, { open: !sel.node.attrs.open })
            }
            return true
          }
          const d = toggleDepth(sel.$from)
          if (d === null) return false
          if (dispatch) {
            const pos = sel.$from.before(d)
            tr.setNodeMarkup(pos, undefined, { open: !sel.$from.node(d).attrs.open })
          }
          return true
        }),
    }
  },

  addProseMirrorPlugins() {
    const name = this.name
    return [
      // Selections can still land in a collapsed body (arrow up from below,
      // collapsing while editing a child, undo) — bounce the caret to the end
      // of the summary of the outermost collapsed toggle.
      new Plugin({
        key: new PluginKey('toggleHiddenGuard'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some(t => t.selectionSet || t.docChanged)) return null
          const { $from, empty } = state.selection
          if (!empty) return null
          for (let d = 1; d <= $from.depth; d++) {
            const n = $from.node(d)
            if (n.type.name === name && !n.attrs.open && $from.index(d) > 0) {
              const summaryEnd = $from.start(d) + n.child(0).nodeSize - 1
              return state.tr.setSelection(TextSelection.create(state.doc, summaryEnd))
            }
          }
          return null
        },
      }),
    ]
  },
})
