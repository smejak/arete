import { Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { useRef, useState } from 'react'
import { EmojiPicker } from '../../components/EmojiPicker'

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <NodeViewWrapper className="callout" data-type="callout">
      <button
        type="button"
        ref={btnRef}
        className="callout-emoji"
        contentEditable={false}
        tabIndex={-1}
        disabled={!editor.isEditable}
        onMouseDown={e => e.preventDefault()}
        onClick={() => setPickerOpen(o => !o)}
        title="Change emoji"
      >
        {node.attrs.emoji}
      </button>
      {pickerOpen && btnRef.current && (
        <EmojiPicker
          anchor={btnRef.current.getBoundingClientRect()}
          onClose={() => setPickerOpen(false)}
          onPick={emoji => {
            if (emoji) updateAttributes({ emoji })
            setPickerOpen(false)
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
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return { emoji: { default: '💡' } }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: el => ({ emoji: (el as HTMLElement).dataset.emoji || '💡' }),
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
