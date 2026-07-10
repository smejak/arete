import { Shuffle, X } from 'lucide-react'
import { EMOJI, randomEmoji } from '../lib/emoji'
import type { Anchor } from '../lib/position'
import { Popover } from './Popover'

export function EmojiPicker({
  anchor,
  onClose,
  onPick,
  allowRemove = false,
}: {
  anchor: Anchor
  onClose: () => void
  /** Called with an emoji, or null when the icon is removed. */
  onPick: (emoji: string | null) => void
  allowRemove?: boolean
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} className="emoji-pop">
      <div className="pop-head">
        <span className="pop-title">Icon</span>
        <div className="pop-head-actions">
          <button type="button" className="pop-action" onClick={() => onPick(randomEmoji())}>
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
      <div className="emoji-grid">
        {EMOJI.map(e => (
          <button type="button" key={e} className="emoji-cell" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </Popover>
  )
}
