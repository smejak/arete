import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { CornerDownRight } from 'lucide-react'
import { useStore } from '../../store/store'
import { blockText, normText } from '../../lib/blocks'
import { PageIcon } from '../../lib/icon'
import { cx } from '../../lib/util'

/**
 * A pointer at a text block somewhere else in the vault.
 *
 * It stores the page and the text as it read when you pointed at it — not an
 * id. Prose is edited, and an id would have to be minted into the markdown of
 * whatever paragraph you happened to reference, which is a permanent cost paid
 * by the source for the benefit of the referrer. The quote is enough to find
 * the block again, and when it no longer matches anything the reference says
 * so rather than pretending: the same bargain the card refs already make.
 */

function BlockRefView({ node, selected }: NodeViewProps) {
  const pageId = node.attrs.pageId as string
  const text = (node.attrs.text as string) || ''
  const page = useStore(s => s.pages[pageId])
  const flashBlock = useStore(s => s.flashBlock)
  // Live check: is that text still somewhere on the page it came from? Same
  // normalisation the jump uses, or the two would disagree about staleness.
  const live = useStore(s => {
    const p = s.pages[pageId]
    if (!p?.content?.content) return false
    const want = normText(text)
    if (!want) return false
    return p.content.content.some(b => normText(blockText(b)).includes(want))
  })

  return (
    <NodeViewWrapper className={cx('block-ref', selected && 'is-selected')} data-type="block-ref">
      <button
        type="button"
        className="bref"
        contentEditable={false}
        disabled={!page}
        onClick={() => page && flashBlock(pageId, text)}
      >
        <span className="bref-mark">
          <CornerDownRight size={13} strokeWidth={1.9} />
        </span>
        <span className={cx('bref-text', !live && 'is-stale')}>{text}</span>
        <span className="bref-src">
          <span className="bref-src-icon">
            <PageIcon icon={page?.icon} size={11} strokeWidth={1.8} />
          </span>
          {page ? page.title || 'Untitled' : 'Page not in this vault'}
          {page && !live && <span className="bref-stale">· as it read then</span>}
        </span>
      </button>
    </NodeViewWrapper>
  )
}

export const BlockRef = Node.create({
  name: 'blockRef',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: { default: null },
      text: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-ref"]',
        getAttrs: el => ({
          pageId: (el as HTMLElement).dataset.pageId ?? null,
          text: (el as HTMLElement).dataset.text ?? '',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'block-ref',
        'data-page-id': node.attrs.pageId,
        'data-text': node.attrs.text,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockRefView)
  },
})
