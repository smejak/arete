import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Maximize2, Table } from 'lucide-react'
import { useStore } from '../../store/store'
import { DatabaseTable } from '../../components/db/DatabaseTable'
import { cx } from '../../lib/util'

function DatabaseBlockView({ node, selected }: NodeViewProps) {
  const pageId = node.attrs.pageId as string
  const page = useStore(s => (pageId ? s.pages[pageId] : undefined))
  const openPage = useStore(s => s.openPage)
  const updateTitle = useStore(s => s.updateTitle)

  if (!page?.db) {
    return (
      <NodeViewWrapper className="db-block" data-type="database">
        <div className="db-gone" contentEditable={false}>
          <Table size={16} strokeWidth={1.7} />
          Deleted database
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      className={cx('db-block', selected && 'is-selected')}
      data-type="database"
    >
      <div className="db-inline" contentEditable={false}>
        <div className="db-inline-head">
          <input
            className="db-inline-title"
            value={page.title}
            placeholder="Untitled"
            spellCheck={false}
            onChange={e => updateTitle(pageId, e.target.value)}
          />
          <button
            type="button"
            className="icon-btn sm db-expand"
            title="Open as full page"
            onClick={() => openPage(pageId)}
          >
            <Maximize2 size={13} strokeWidth={1.8} />
          </button>
        </div>
        <DatabaseTable dbId={pageId} inline />
      </div>
    </NodeViewWrapper>
  )
}

/**
 * Inline database, the Notion way: the block only points at a database page
 * (whose children are the rows). `owner` mirrors pageLink — deleting an
 * owning block deletes the database and its rows after the grace period.
 */
export const DatabaseBlock = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: { default: null },
      owner: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="database"]',
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
        'data-type': 'database',
        'data-page-id': node.attrs.pageId,
        'data-owner': node.attrs.owner ? 'true' : undefined,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView, {
      // The table is a fully interactive island; keep ProseMirror's hands off
      // everything except drag/drop (so the block handle can still move it).
      stopEvent: ({ event }) => !event.type.startsWith('drag') && event.type !== 'drop',
    })
  },
})
