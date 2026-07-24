import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileX } from 'lucide-react'
import { useStore } from '../../store/store'
import { PageIcon } from '../../lib/icon'
import { cx } from '../../lib/util'

function PageLinkView({ node, selected }: NodeViewProps) {
  const pageId = node.attrs.pageId as string
  const page = useStore(s => (pageId ? s.pages[pageId] : undefined))
  const openPage = useStore(s => s.openPage)

  return (
    <NodeViewWrapper
      className={cx('page-link-block', selected && 'is-selected')}
      data-type="page-link"
      data-page-id={pageId}
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
            <PageIcon icon={page.icon} size={16} strokeWidth={1.7} />
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
    return ReactNodeViewRenderer(PageLinkView, {
      // The default stopEvent eats drag/drop over the block, which made
      // dropping other blocks between subpage links silently fail — let
      // ProseMirror see everything drag-related.
      stopEvent: ({ event }) => !(event.type.startsWith('drag') || event.type === 'drop'),
    })
  },

  addProseMirrorPlugins() {
    const name = this.name
    /** The dragged slice is exactly one OWNED subpage block. */
    const draggedOwnedLink = (view: import('@tiptap/pm/view').EditorView) => {
      const slice = view.dragging?.slice
      if (!slice || slice.content.childCount !== 1) return null
      const node = slice.content.firstChild
      return node && node.type.name === name && node.attrs.owner ? node : null
    }
    const clearHover = (view: import('@tiptap/pm/view').EditorView) => {
      view.dom
        .querySelectorAll('.page-link-block.drop-into')
        .forEach(el => el.classList.remove('drop-into'))
    }

    return [
      new Plugin({
        key: new PluginKey('pageLinkNest'),
        props: {
          // Dropping a subpage block ONTO another subpage nests it there —
          // same semantics as the sidebar: the block leaves this page and
          // appends to the target subpage, hierarchy follows.
          handleDrop(view, event, slice, moved) {
            if (!moved || slice.content.childCount !== 1) return false
            const dragged = slice.content.firstChild
            if (!dragged || dragged.type.name !== name || !dragged.attrs.owner) return false
            const targetEl = (event.target as HTMLElement | null)?.closest?.('.page-link-block')
            if (!(targetEl instanceof HTMLElement)) return false
            // Only the middle band nests — the edges mean "reorder next to
            // it", which ProseMirror's default drop handles.
            const r = targetEl.getBoundingClientRect()
            const frac = (event.clientY - r.top) / Math.max(1, r.height)
            if (frac < 0.3 || frac > 0.7) return false
            const targetPageId = targetEl.dataset.pageId
            const draggedPageId = dragged.attrs.pageId as string | null
            if (!targetPageId || !draggedPageId || targetPageId === draggedPageId) return false
            clearHover(view)
            event.preventDefault()
            // movePage does the rest: reparent, strip this page's owner
            // block, append one to the new parent, refresh open editors.
            useStore.getState().movePage(draggedPageId, { type: 'inside', id: targetPageId })
            return true
          },
          handleDOMEvents: {
            dragover(view, event) {
              const dragged = draggedOwnedLink(view)
              if (!dragged) return false
              clearHover(view)
              const el = (event.target as HTMLElement | null)?.closest?.('.page-link-block')
              if (el instanceof HTMLElement && el.dataset.pageId && el.dataset.pageId !== dragged.attrs.pageId) {
                const r = el.getBoundingClientRect()
                const frac = (event.clientY - r.top) / Math.max(1, r.height)
                if (frac >= 0.3 && frac <= 0.7) el.classList.add('drop-into')
              }
              return false
            },
            drop(view) {
              clearHover(view)
              return false
            },
            dragend(view) {
              clearHover(view)
              return false
            },
          },
        },
      }),
    ]
  },
})
