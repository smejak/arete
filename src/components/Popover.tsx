import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, type LucideIcon } from 'lucide-react'
import { placeFloating, type Anchor, type Placed } from '../lib/position'
import { cx } from '../lib/util'

export function Popover({
  anchor,
  onClose,
  children,
  className,
  align = 'start',
  gap = 6,
}: {
  anchor: Anchor
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'start' | 'end'
  gap?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Placed | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(placeFloating(anchor, { width: el.offsetWidth, height: el.offsetHeight }, { align, gap }))
  }, [anchor, align, gap])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      className={cx('popover', className)}
      style={
        pos
          ? { top: pos.top, left: pos.left, transformOrigin: pos.origin }
          : { top: 0, left: 0, visibility: 'hidden' }
      }
    >
      {children}
    </div>,
    document.body,
  )
}

export type MenuEntry =
  | {
      kind?: 'item'
      icon?: LucideIcon
      label: string
      hint?: string
      danger?: boolean
      active?: boolean
      onSelect: () => void
    }
  | { kind: 'sep' }
  | { kind: 'note'; label: string }

export function Menu({ entries }: { entries: MenuEntry[] }) {
  return (
    <div className="menu">
      {entries.map((entry, i) => {
        if (entry.kind === 'sep') return <div key={i} className="menu-sep" />
        if (entry.kind === 'note')
          return (
            <div key={i} className="menu-note">
              {entry.label}
            </div>
          )
        const Icon = entry.icon
        return (
          <button
            key={i}
            type="button"
            className={cx('menu-item', entry.danger && 'is-danger')}
            onClick={e => {
              e.stopPropagation()
              entry.onSelect()
            }}
          >
            {Icon && <Icon size={15} strokeWidth={1.7} />}
            <span className="menu-label">{entry.label}</span>
            {entry.hint && <span className="menu-hint">{entry.hint}</span>}
            {entry.active && <Check size={14} strokeWidth={2.2} className="menu-check" />}
          </button>
        )
      })}
    </div>
  )
}
