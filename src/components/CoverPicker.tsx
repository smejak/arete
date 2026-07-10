import { X } from 'lucide-react'
import { COVERS, COVER_KEYS } from '../lib/covers'
import type { Anchor } from '../lib/position'
import { Popover } from './Popover'

export function CoverPicker({
  anchor,
  onClose,
  onPick,
  align = 'start',
}: {
  anchor: Anchor
  onClose: () => void
  /** Called with a cover key, or null when the cover is removed. */
  onPick: (cover: string | null) => void
  align?: 'start' | 'end'
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} className="cover-pop" align={align}>
      <div className="pop-head">
        <span className="pop-title">Cover</span>
        <div className="pop-head-actions">
          <button type="button" className="pop-action" onClick={() => onPick(null)}>
            <X size={12} strokeWidth={2} />
            Remove
          </button>
        </div>
      </div>
      <div className="cover-grid">
        {COVER_KEYS.map(key => (
          <button type="button" key={key} className="cover-swatch" onClick={() => onPick(key)}>
            <span className="cover-thumb" style={{ background: COVERS[key].css }} />
            <span className="cover-name">{COVERS[key].name}</span>
          </button>
        ))}
      </div>
    </Popover>
  )
}
