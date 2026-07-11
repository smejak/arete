import { Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { useState } from 'react'
import { EmojiPicker } from '../../components/EmojiPicker'
import { cx } from '../../lib/util'

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [pickerAt, setPickerAt] = useState<DOMRect | null>(null)
  const emoji = (node.attrs.emoji as string) || ''

  return (
    <NodeViewWrapper className={cx('callout', !emoji && 'no-emoji')} data-type="callout">
      {emoji && (
        <button
          type="button"
          className="callout-emoji"
          contentEditable={false}
          tabIndex={-1}
          disabled={!editor.isEditable}
          onMouseDown={e => e.preventDefault()}
          onClick={e => setPickerAt(e.currentTarget.getBoundingClientRect())}
          title="Change emoji"
        >
          {emoji}
        </button>
      )}
      {pickerAt && (
        <EmojiPicker
          anchor={pickerAt}
          allowRemove={!!emoji}
          onClose={() => setPickerAt(null)}
          onPick={picked => {
            updateAttributes({ emoji: picked ?? '' })
            setPickerAt(null)
          }}
        />
      )}
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  // Full blocks inside: lists, toggles, code, quotes — not just paragraphs.
  content: 'block+',
  defining: true,

  addAttributes() {
    return { emoji: { default: '💡' } }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: el => ({ emoji: (el as HTMLElement).dataset.emoji ?? '' }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout', 'data-emoji': node.attrs.emoji }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addKeyboardShortcuts() {
    return {
      // Enter on a trailing empty line steps out of the callout instead of
      // growing it forever.
      Enter: () =>
        this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection
          if (!empty) return false
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type.name !== this.name) continue
            const callout = $from.node(depth)
            const para = $from.parent
            if (para.type.name !== 'paragraph' || para.content.size > 0) return false
            // Only a paragraph sitting directly in the callout escapes.
            if ($from.depth !== depth + 1) return false
            const isLastChild = $from.index(depth) === callout.childCount - 1
            if (!isLastChild || callout.childCount < 2) return false
            if (dispatch) {
              const afterCallout = $from.after(depth)
              tr.delete($from.before($from.depth), $from.after($from.depth))
              const insertAt = tr.mapping.map(afterCallout)
              tr.insert(insertAt, state.schema.nodes.paragraph.create())
              tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
              tr.scrollIntoView()
            }
            return true
          }
          return false
        }),
    }
  },
})
