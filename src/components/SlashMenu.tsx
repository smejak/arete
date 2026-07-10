import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import type { SlashItem } from '../editor/SlashCommand'
import { placeFloating, type Placed } from '../lib/position'

export interface SuggestView<T> {
  items: T[]
  index: number
  rect: DOMRect | null
  execute: (index: number) => void
  setIndex: (index: number) => void
}

/**
 * Bridges a TipTap suggestion plugin (slash menu, @ mentions, …) into React
 * state. Returns the current menu view (null = closed) and the suggestion
 * config to pass to the matching editor extension.
 */
export function useSuggestionMenu<T>(): [SuggestView<T> | null, Partial<SuggestionOptions<T>>] {
  const [view, setView] = useState<SuggestView<T> | null>(null)
  const ref = useRef<{
    props: SuggestionProps<T> | null
    index: number
    dismissed: boolean
  }>({ props: null, index: 0, dismissed: false })

  const suggestion = useMemo<Partial<SuggestionOptions<T>>>(() => {
    const sync = () => {
      const s = ref.current
      if (!s.props || s.dismissed || s.props.items.length === 0) {
        setView(null)
        return
      }
      const props = s.props
      setView({
        items: props.items,
        index: s.index,
        rect: props.clientRect?.() ?? null,
        execute: i => {
          const item = props.items[i]
          if (item) props.command(item)
        },
        setIndex: i => {
          ref.current.index = i
          sync()
        },
      })
    }

    return {
      render: () => ({
        onStart: props => {
          ref.current = { props, index: 0, dismissed: false }
          sync()
        },
        onUpdate: props => {
          const s = ref.current
          s.props = props
          s.index = Math.min(s.index, Math.max(0, props.items.length - 1))
          sync()
        },
        onKeyDown: ({ event }) => {
          const s = ref.current
          if (!s.props || s.dismissed) return false
          if (event.key === 'Escape') {
            s.dismissed = true
            sync()
            return true
          }
          const n = s.props.items.length
          if (n === 0) return false
          if (event.key === 'ArrowDown') {
            s.index = (s.index + 1) % n
            sync()
            return true
          }
          if (event.key === 'ArrowUp') {
            s.index = (s.index - 1 + n) % n
            sync()
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            s.props.command(s.props.items[s.index])
            return true
          }
          return false
        },
        onExit: () => {
          ref.current.props = null
          setView(null)
        },
      }),
    }
  }, [])

  return [view, suggestion]
}

/**
 * Shared chrome for suggestion menus: fixed positioning near the caret with
 * flip + clamp, and keep-selected-row-visible scrolling.
 */
export function useMenuPosition<T>(view: SuggestView<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Placed | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !view.rect) return
    setPos(placeFloating(view.rect, { width: el.offsetWidth, height: el.offsetHeight }, { gap: 8 }))
  }, [view.rect, view.items.length])

  useEffect(() => {
    ref.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [view.index])

  const style = pos
    ? { top: pos.top, left: pos.left, transformOrigin: pos.origin }
    : { top: 0, left: 0, visibility: 'hidden' as const }

  return { ref, style }
}

export function SlashMenu({ view }: { view: SuggestView<SlashItem> }) {
  const { ref, style } = useMenuPosition(view)

  let lastSection = ''
  return createPortal(
    <div ref={ref} className="popover slash-menu" style={style}>
      {view.items.map((item, i) => {
        const label = item.section !== lastSection ? item.section : null
        lastSection = item.section
        const Icon = item.icon
        return (
          <Fragment key={item.id}>
            {label && <div className="slash-label">{label}</div>}
            <button
              type="button"
              className="slash-item"
              data-selected={i === view.index || undefined}
              onMouseDown={e => e.preventDefault()}
              onMouseMove={() => view.index !== i && view.setIndex(i)}
              onClick={() => view.execute(i)}
            >
              <span className="slash-icon">
                <Icon size={16} strokeWidth={1.7} />
              </span>
              <span className="slash-text">
                <span className="slash-title">{item.title}</span>
                <span className="slash-desc">{item.description}</span>
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>,
    document.body,
  )
}
