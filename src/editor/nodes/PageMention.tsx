import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileText } from 'lucide-react'
import { useStore } from '../../store/store'
import { cx } from '../../lib/util'

function PageMentionView({ node, selected }: NodeViewProps) {
  const pageId = node.attrs.pageId as string
  const page = useStore(s => (pageId ? s.pages[pageId] : undefined))
  const openPage = useStore(s => s.openPage)

  return (
    <NodeViewWrapper
      as="span"
      className={cx('page-mention', selected && 'is-selected', !page && 'is-gone')}
      data-type="page-mention"
      contentEditable={false}
      role="link"
      title={page ? 'Open page' : 'This page was deleted'}
      onClick={() => page && openPage(pageId)}
    >
      <span className="pm-icon">
        {page?.icon ?? <FileText size={13} strokeWidth={1.8} />}
      </span>
      <span className="pm-title">{page ? page.title || 'Untitled' : 'Deleted page'}</span>
    </NodeViewWrapper>
  )
}

export const PageMention = Node.create({
  name: 'pageMention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return { pageId: { default: null } }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="page-mention"]',
        getAttrs: el => ({ pageId: (el as HTMLElement).dataset.pageId ?? null }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-mention',
        'data-page-id': node.attrs.pageId,
      }),
    ]
  },

  renderText({ node }) {
    const page = useStore.getState().pages[node.attrs.pageId as string]
    return '@' + (page ? page.title || 'Untitled' : 'page')
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageMentionView)
  },
})
