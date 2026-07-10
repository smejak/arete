export type Anchor = DOMRect | { x: number; y: number }

export interface Placed {
  top: number
  left: number
  origin: string
}

/**
 * Position a floating element near an anchor (rect or point), flipping above
 * when there's more room, and clamping to the viewport with an 8px inset.
 */
export function placeFloating(
  anchor: Anchor,
  size: { width: number; height: number },
  opts: { gap?: number; align?: 'start' | 'end' } = {},
): Placed {
  const gap = opts.gap ?? 6
  const r =
    'width' in anchor
      ? { top: anchor.top, bottom: anchor.bottom, left: anchor.left, right: anchor.right }
      : { top: anchor.y, bottom: anchor.y, left: anchor.x, right: anchor.x }
  const vw = window.innerWidth
  const vh = window.innerHeight

  const spaceBelow = vh - r.bottom - gap - 8
  const spaceAbove = r.top - gap - 8
  const down = size.height <= spaceBelow || spaceBelow >= spaceAbove

  let top = down ? r.bottom + gap : r.top - gap - size.height
  top = Math.max(8, Math.min(top, vh - size.height - 8))

  let left = opts.align === 'end' ? r.right - size.width : r.left
  left = Math.max(8, Math.min(left, vw - size.width - 8))

  return { top, left, origin: `${down ? 'top' : 'bottom'} ${opts.align === 'end' ? 'right' : 'left'}` }
}
