import { useMemo } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Layers } from 'lucide-react'
import { useStore } from '../../store/store'
import { blockText } from '../../lib/blocks'
import { colorOf, groupBlocks, isGroup } from '../../lib/tags'
import { cx } from '../../lib/util'

/**
 * A pointer at a group rather than a block.
 *
 * Its blocks live on different pages, so there is nowhere to navigate to —
 * following it opens the group's window instead, which is the same surface
 * used to arrange it. Nothing about the group is stored here but its tag: the
 * membership and the order are resolved when it opens, so this stays right as
 * blocks are tagged, untagged and reordered.
 */
/** Enough of each block to recognise it, without becoming the blocks. */
const PREVIEW = 3

function GroupRefView({ node, selected }: NodeViewProps) {
  const tag = (node.attrs.tag as string) || ''
  const registry = useStore(s => s.tagRegistry)
  const setOpenGroup = useStore(s => s.setOpenGroup)
  const pages = useStore(s => s.pages)
  const stillAGroup = isGroup(registry, tag)

  const order = registry.find(t => t.name === tag)?.order
  const members = useMemo(() => groupBlocks(pages, tag, order), [pages, tag, order])
  const shown = members.slice(0, PREVIEW)
  const rest = members.length - shown.length

  return (
    <NodeViewWrapper className={cx('group-ref', selected && 'is-selected')} data-type="group-ref">
      <button type="button" className="gref" contentEditable={false} onClick={() => setOpenGroup(tag)}>
        <span className="gref-head">
          <span className="gref-mark">
            <Layers size={13} strokeWidth={1.9} />
          </span>
          <span className={cx('db-chip', 'dbo-' + colorOf(registry, tag))}>{tag}</span>
          <span className="gref-count">
            {members.length} block{members.length === 1 ? '' : 's'}
            {!stillAGroup && <span className="bref-stale"> · no longer a group</span>}
          </span>
        </span>
        {shown.length > 0 && (
          <span className="gref-lines">
            {shown.map((m, i) => (
              <span key={m.blockId || i} className="gref-line">
                {blockText(m.node).trim() || 'Empty block'}
              </span>
            ))}
            {rest > 0 && <span className="gref-more">and {rest} more</span>}
          </span>
        )}
      </button>
    </NodeViewWrapper>
  )
}

export const GroupRef = Node.create({
  name: 'groupRef',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { tag: { default: '' } }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="group-ref"]',
        getAttrs: el => ({ tag: (el as HTMLElement).dataset.tag ?? '' }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'group-ref', 'data-tag': node.attrs.tag }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(GroupRefView)
  },
})
