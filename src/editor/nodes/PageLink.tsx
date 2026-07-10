import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileText, FileX } from 'lucide-react'
import { useStore } from '../../store/store'
import { cx } from '../../lib/util'

function PageLinkView({ node, selected }: NodeViewProps) {
  const pageId = node.attrs.pageId as string
  const page = useStore(s => (pageId ? s.pages[pageId] : undefined))
  const openPage = useStore(s => s.openPage)

  return (
    <NodeViewWrapper
      className={cx('page-link-block', selected && 'is-selected')}
      data-type="page-link"
    >
      <button
        type="button"
        className="plb"
        contentEditable={false}
        disabled={!page}
        onClick={() => page && openPage(pageId)}
      >
        <span className="plb-icon">
          {page ? (
            page.icon ?? <FileText size={16} strokeWidth={1.7} />
          ) : (
            <FileX size={16} strokeWidth={1.7} />
          )}
        </span>
        <span className={cx('plb-title', !page && 'plb-gone')}>
          {page ? page.title || 'Untitled' : 'Deleted page'}
        </span>
      </button>
    </NodeViewWrapper>
  )
}

export const PageLink = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: { default: null },
      /** True when this block *is* the subpage (created via /page): removing
       * the block deletes the page. Plain links/mentions stay false. */
      owner: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="page-link"]',
        getAttrs: el => ({
          pageId: (el as HTMLElement).dataset.pageId ?? null,
          owner: (el as HTMLElement).dataset.owner === 'true',
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-link',
        'data-page-id': node.attrs.pageId,
        'data-owner': node.attrs.owner ? 'true' : undefined,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView)
  },
})
