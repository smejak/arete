import { useMemo, useState } from 'react'
import { Search, Shuffle, X } from 'lucide-react'
import { EMOJI, randomEmoji } from '../lib/emoji'
import { PageIcon, lucideIcon, lucideNames } from '../lib/icon'
import { cx } from '../lib/util'
import type { Anchor } from '../lib/position'
import { Popover } from './Popover'

/** How many icon results to render at once — the set is ~1,500, so we cap and
 * lean on search to narrow. */
const MAX_ICONS = 120

const randomLucide = () => lucideIcon(lucideNames[Math.floor(Math.random() * lucideNames.length)])

export function EmojiPicker({
  anchor,
  onClose,
  onPick,
  allowRemove = false,
  allowIcons = false,
}: {
  anchor: Anchor
  onClose: () => void
  /** Called with an emoji, a "lucide:name" icon, or null when removed. */
  onPick: (icon: string | null) => void
  allowRemove?: boolean
  /** Show the searchable open-source (Lucide) icon set alongside emoji. */
  allowIcons?: boolean
}) {
  const [tab, setTab] = useState<'emoji' | 'icons'>('emoji')
  const [query, setQuery] = useState('')

  const icons = useMemo(() => {
    const q = query.toLowerCase().trim()
    const list = q ? lucideNames.filter(n => n.includes(q)) : lucideNames
    return { shown: list.slice(0, MAX_ICONS), total: list.length }
  }, [query])

  const onIcons = allowIcons && tab === 'icons'

  return (
    <Popover anchor={anchor} onClose={onClose} className="emoji-pop">
      <div className="pop-head">
        <span className="pop-title">Icon</span>
        <div className="pop-head-actions">
          <button
            type="button"
            className="pop-action"
            onClick={() => onPick(onIcons ? randomLucide() : randomEmoji())}
          >
            <Shuffle size={12} strokeWidth={2} />
            Random
          </button>
          {allowRemove && (
            <button type="button" className="pop-action" onClick={() => onPick(null)}>
              <X size={12} strokeWidth={2} />
              Remove
            </button>
          )}
        </div>
      </div>

      {allowIcons && (
        <div className="pop-tabs">
          <button
            type="button"
            className={cx('pop-tab', tab === 'emoji' && 'is-active')}
            onClick={() => setTab('emoji')}
          >
            Emoji
          </button>
          <button
            type="button"
            className={cx('pop-tab', tab === 'icons' && 'is-active')}
            onClick={() => setTab('icons')}
          >
            Icons
          </button>
        </div>
      )}

      {onIcons ? (
        <>
          <div className="icon-search">
            <Search size={13} strokeWidth={2} />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search 1,500+ icons…"
            />
          </div>
          <div className="emoji-grid icon-grid">
            {icons.shown.map(name => (
              <button
                type="button"
                key={name}
                className="emoji-cell icon-cell"
                title={name}
                onClick={() => onPick(lucideIcon(name))}
              >
                <PageIcon icon={lucideIcon(name)} size={18} strokeWidth={1.8} />
              </button>
            ))}
          </div>
          {icons.total === 0 ? (
            <div className="icon-note">No icons match “{query.trim()}”.</div>
          ) : icons.total > icons.shown.length ? (
            <div className="icon-note">
              {icons.total - icons.shown.length} more — keep typing to narrow.
            </div>
          ) : null}
        </>
      ) : (
        <div className="emoji-grid">
          {EMOJI.map(e => (
            <button type="button" key={e} className="emoji-cell" onClick={() => onPick(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
