import { Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
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
    return ReactNodeViewRenderer(CalloutView, {
      // Same drag/drop passthrough as Toggle/PageLink: without it, drops on
      // the callout's chrome do nothing. Only the emoji button stays stopped.
      stopEvent: ({ event }) => {
        if (event.type.startsWith('drag') || event.type === 'drop') return false
        const el = event.target as HTMLElement | null
        return !!el && !el.closest?.('.callout-body')
      },
    })
  },

  addKeyboardShortcuts() {
    return {
      // Enter inside a callout only ever makes another line. Without this,
      // PM's base-keymap liftEmptyBlock claims empty paragraphs: mid-callout
      // it SPLITS the callout in two, on the last line it lifts the paragraph
      // out. You leave a callout by clicking below it, not by pressing return.
      Enter: () => {
        const { $from, empty } = this.editor.state.selection
        if (!empty) return false
        const para = $from.parent
        if (para.type.name !== 'paragraph' || para.content.size > 0) return false
        if ($from.node(-1).type.name !== this.name) return false
        return this.editor.commands.splitBlock()
      },
    }
  },
})
