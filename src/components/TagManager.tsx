import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { useStore } from '../store/store'
import { OPTION_COLORS } from '../lib/db'
import { colorOf, kindOf, normalizeTag, tagUsage } from '../lib/tags'
import { cx } from '../lib/util'
import { Popover } from './Popover'

/**
 * The whole vocabulary, in one place.
 *
 * It lists what is actually in use, not what the registry happens to hold —
 * the registry only ever decorated a vocabulary the blocks own. A tag with no
 * registry entry appears here like any other, with the colour it was given by
 * its name; editing it is what creates the entry.
 *
 * Kind is shown and never changed. A tag that swapped sides would silently
 * change what every existing reference to it is allowed to do.
 */
export function TagManager({ onClose }: { onClose: () => void }) {
  const pages = useStore(s => s.pages)
  const registry = useStore(s => s.tagRegistry)
  const setTagColor = useStore(s => s.setTagColor)
  const renameTag = useStore(s => s.renameTag)
  const removeTagEverywhere = useStore(s => s.removeTagEverywhere)
  const setOpenGroup = useStore(s => s.setOpenGroup)

  const [swatchFor, setSwatchFor] = useState<{ name: string; at: DOMRect } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const usage = useMemo(() => tagUsage(pages), [pages])
  const rows = useMemo(() => {
    // Everything in use, plus registry entries kept for their settings even
    // when nothing carries them right now.
    const names = new Set([...usage.keys(), ...registry.map(t => t.name)])
    return [...names]
      .map(name => ({ name, n: usage.get(name) ?? 0, kind: kindOf(registry, name) }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [usage, registry])

  const commitRename = (from: string) => {
    const to = normalizeTag(draft)
    setRenaming(null)
    if (to && to !== from) renameTag(from, to)
  }

  return createPortal(
    <div className="group-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="group-panel tagman-panel">
        <div className="group-head">
          <TagIcon size={15} strokeWidth={1.9} />
          <span className="tagman-title">Tags</span>
          <span className="group-count">
            {rows.length} in this vault
          </span>
          <button type="button" className="icon-btn sm" onClick={onClose} title="Close (esc)">
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>

        <div className="group-body">
          {rows.length === 0 ? (
            <div className="group-empty">
              No tags yet. Add one from any block's handle — you choose there whether it is a
              category or a group.
            </div>
          ) : (
            rows.map(row => (
              <div key={row.name} className="tagman-row">
                <button
                  type="button"
                  className={cx('db-chip', 'dbo-' + colorOf(registry, row.name), 'group-chip')}
                  title="Change colour"
                  onClick={e =>
                    setSwatchFor(
                      swatchFor?.name === row.name
                        ? null
                        : { name: row.name, at: e.currentTarget.getBoundingClientRect() },
                    )
                  }
                >
                  {row.name}
                </button>

                {renaming === row.name ? (
                  <input
                    className="tagman-rename"
                    autoFocus
                    value={draft}
                    spellCheck={false}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={() => commitRename(row.name)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRename(row.name)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setRenaming(null)
                      }
                    }}
                  />
                ) : (
                  <span className="tagman-kind">
                    {row.kind === 'group' ? (
                      <>
                        <Layers size={11} strokeWidth={2} /> group
                      </>
                    ) : (
                      'category'
                    )}
                  </span>
                )}

                <span className="tagman-count">
                  {row.n} block{row.n === 1 ? '' : 's'}
                </span>

                {confirming === row.name ? (
                  <span className="confirm-inline tagman-confirm">
                    <span>Remove from every block?</span>
                    <button type="button" className="btn" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        removeTagEverywhere(row.name)
                        setConfirming(null)
                      }}
                    >
                      Remove
                    </button>
                  </span>
                ) : (
                  <span className="tagman-actions">
                    <button
                      type="button"
                      className="icon-btn sm"
                      title="Rename everywhere"
                      onClick={() => {
                        setRenaming(row.name)
                        setDraft(row.name)
                      }}
                    >
                      <Pencil size={13} strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm"
                      title={row.kind === 'group' ? 'Open the group' : 'Browse these blocks'}
                      onClick={() => {
                        onClose()
                        setOpenGroup(row.name)
                      }}
                    >
                      <Layers size={13} strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm tagman-del"
                      title="Remove this tag everywhere"
                      onClick={() => setConfirming(row.name)}
                    >
                      <Trash2 size={13} strokeWidth={1.8} />
                    </button>
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        <div className="group-foot">
          <span className="composer-hint">
            Renaming and removing reach every block in the vault. Whether a tag is a category or a
            group was settled when it was made.
          </span>
        </div>
      </div>

      {swatchFor && (
        <Popover anchor={swatchFor.at} onClose={() => setSwatchFor(null)} className="tag-swatches">
          {OPTION_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={cx('tag-swatch', 'dbo-' + c, colorOf(registry, swatchFor.name) === c && 'is-on')}
              title={c}
              onClick={() => {
                setTagColor(swatchFor.name, c)
                setSwatchFor(null)
              }}
            />
          ))}
        </Popover>
      )}
    </div>,
    document.body,
  )
}
