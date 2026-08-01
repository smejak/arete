import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, X } from 'lucide-react'
import { useStore } from '../store/store'
import { blockText } from '../lib/blocks'
import { colorOf, groupBlocks, kindOf, type BlockAddr } from '../lib/tags'
import { PageIcon } from '../lib/icon'
import { OPTION_COLORS } from '../lib/db'
import { Popover } from './Popover'
import { cx } from '../lib/util'

/**
 * A group, in front of the page.
 *
 * Not a page and never becomes one: it is assembled from whatever currently
 * carries the tag, in the order the registry remembers. Blocks tagged since
 * appear at the end; blocks that lost the tag simply are not here. Dragging
 * writes the order back — the only thing about a group that is stored.
 *
 * The same window serves both jobs the design asks of it. Following a
 * reference to a group opens this, because the blocks live on different pages
 * and there is nowhere else for a reader to land.
 */
export function GroupWindow({ tag, onClose }: { tag: string; onClose: () => void }) {
  const pages = useStore(s => s.pages)
  const registry = useStore(s => s.tagRegistry)
  const setTagOrder = useStore(s => s.setTagOrder)
  const setTagColor = useStore(s => s.setTagColor)
  const flashBlock = useStore(s => s.flashBlock)

  const def = registry.find(t => t.name === tag)
  const kind = kindOf(registry, tag)
  const orderable = kind === 'group'
  const members = useMemo(() => groupBlocks(pages, tag, def?.order), [pages, tag, def?.order])

  const [swatches, setSwatches] = useState<DOMRect | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commit = (from: string, to: string) => {
    if (from === to) return
    const ids = members.map(m => m.blockId || `${m.pageId}:${m.index}`)
    const a = ids.indexOf(from)
    const b = ids.indexOf(to)
    if (a === -1 || b === -1) return
    const next = [...members]
    const [moved] = next.splice(a, 1)
    next.splice(b, 0, moved)
    // Only blocks with an id can be ordered; the rest keep their document
    // order behind the sequence, which is what groupBlocks already does.
    const order: BlockAddr[] = next
      .filter(m => m.blockId)
      .map(m => ({ pageId: m.pageId, blockId: m.blockId }))
    setTagOrder(tag, order)
  }

  return createPortal(
    <div
      className="group-overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="group-panel">
        <div className="group-head">
          <button
            type="button"
            className={cx('db-chip', 'dbo-' + colorOf(registry, tag), 'group-chip')}
            title="Change colour"
            onClick={e => setSwatches(swatches ? null : e.currentTarget.getBoundingClientRect())}
          >
            {tag}
          </button>
          {/* Stated, not offered: what a tag is was decided when it was made.
              Converting one would quietly change what every existing
              reference to it is allowed to do. */}
          <span className="group-kind-label">{orderable ? 'Group' : 'Category'}</span>
          <span className="group-count">
            {members.length} block{members.length === 1 ? '' : 's'}
          </span>
          <button type="button" className="icon-btn sm" onClick={onClose} title="Close (esc)">
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>

        <div className="group-body" ref={listRef}>
          {members.length === 0 ? (
            <div className="group-empty">
              Nothing carries <strong>#{tag}</strong> yet. Tag a block from its handle and it
              appears here.
            </div>
          ) : (
            members.map(m => {
              const key = m.blockId || `${m.pageId}:${m.index}`
              const page = pages[m.pageId]
              return (
                <div
                  key={key}
                  className={cx(
                    'group-row',
                    dragging === key && 'is-dragging',
                    over === key && dragging && dragging !== key && 'is-over',
                  )}
                  draggable={orderable && !!m.blockId}
                  onDragStart={e => {
                    setDragging(key)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={e => {
                    e.preventDefault()
                    setOver(key)
                  }}
                  onDrop={e => {
                    e.preventDefault()
                    if (dragging) commit(dragging, key)
                    setDragging(null)
                    setOver(null)
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                >
                  <span className="group-grip" title={m.blockId ? 'Drag to reorder' : 'Tag it again to make it orderable'}>
                    <GripVertical size={14} strokeWidth={1.8} />
                  </span>
                  <button
                    type="button"
                    className="group-text"
                    onClick={() => {
                      onClose()
                      flashBlock(m.pageId, blockText(m.node))
                    }}
                  >
                    {blockText(m.node) || <em>Empty block</em>}
                  </button>
                  <span className="group-src">
                    <span className="group-src-icon">
                      <PageIcon icon={page?.icon} size={11} strokeWidth={1.8} />
                    </span>
                    {page ? page.title || 'Untitled' : 'Unknown page'}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="group-foot">
          <span className="composer-hint">
            {orderable
              ? 'Drag to set the order this group reads in — it is saved for the tag.'
              : 'A category finds blocks one at a time. Make it a group to order it and reference it whole.'}
          </span>
        </div>
      </div>

      {swatches && (
        <Popover anchor={swatches} onClose={() => setSwatches(null)} className="tag-swatches">
          {OPTION_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={cx('tag-swatch', 'dbo-' + c, colorOf(registry, tag) === c && 'is-on')}
              title={c}
              onClick={() => {
                setTagColor(tag, c)
                setSwatches(null)
              }}
            />
          ))}
        </Popover>
      )}
    </div>,
    document.body,
  )
}
